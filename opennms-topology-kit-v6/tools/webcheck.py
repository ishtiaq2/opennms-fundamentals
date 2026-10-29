#!/usr/bin/env python3
"""What a browser gets from an OpenNMS web UI. ./dev.sh up and ./dev.sh status use this.

  webcheck.py health <base> <user> <password>   the health checks that do not pass (rest/health)
  webcheck.py nodes <base> <user> <password> [<address for a browser>]
                                                how many nodes each requisition has; a link to the Path Outage view
  webcheck.py login <base> <user> <password>    log in the way a browser does: login page, session cookie,
                                                CSRF token, POST to j_spring_security_check, next page
  webcheck.py page <base>                       only the login page: its CSRF token field and session cookie

<base> is the address of OpenNMS, such as http://192.168.0.47:8980/opennms.
Exit status 0: healthy, the login works, the page answers.
"""
import base64
import http.cookiejar
import json
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

TIMEOUT = 40
TLS = ssl._create_unverified_context()  # development and production may use self-signed certificates


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # urllib then raises HTTPError with the 3xx status


class Browser:
    """One cookie jar, like one browser tab. Secure cookies are not sent over http, as in a browser."""

    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.http = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar), urllib.request.HTTPSHandler(context=TLS), NoRedirect)

    def get(self, url, data=None, auth=None, hops=5, accept=None):
        """(status, final url, headers of each answer, body). Follows redirects itself, so it sees every cookie."""
        answers = []
        for _ in range(hops):
            request = urllib.request.Request(url, data=data)
            if accept:
                request.add_header('Accept', accept)
            if auth:
                request.add_header('Authorization', 'Basic ' + base64.b64encode(auth.encode()).decode())
            try:
                with self.http.open(request, timeout=TIMEOUT) as r:
                    answers.append(r.headers)
                    return r.status, url, answers, r.read().decode('utf-8', 'replace')
            except urllib.error.HTTPError as e:
                answers.append(e.headers)
                if e.code in (301, 302, 303, 307, 308) and e.headers.get('Location'):
                    url, data = urllib.parse.urljoin(url, e.headers['Location']), None
                    continue
                return e.code, url, answers, e.read().decode('utf-8', 'replace')
        return 0, url, answers, ''


class Forms(HTMLParser):
    def __init__(self):
        super().__init__()
        self.forms, self.base = [], None

    def handle_starttag(self, tag, attrs):
        a = {k: (v or '') for k, v in attrs}
        if tag == 'base' and a.get('href'):
            self.base = a['href']
        elif tag == 'form':
            self.forms.append({'action': a.get('action', ''), 'fields': []})
        elif tag in ('input', 'button') and self.forms:
            self.forms[-1]['fields'].append((tag, a.get('type', 'submit' if tag == 'button' else 'text').lower(),
                                             a.get('name', ''), a.get('value', '')))


def login_form(page):
    parser = Forms()
    parser.feed(page)
    for form in parser.forms:
        if 'j_spring_security_check' in form['action'] or any(t == 'password' for _, t, _, _ in form['fields']):
            return form, parser.base
    return None, parser.base


def is_login_page(body, url):
    """The login page again? (Not any form with a password: OpenNMS may ask to change the default password.)"""
    if urllib.parse.urlsplit(url).path.endswith('login.jsp'):
        return True
    parser = Forms()
    parser.feed(body)
    return any('j_spring_security_check' in f['action'] for f in parser.forms)


def cookies_set(answers):
    """The session cookies the answers set, as 'NAME; Path=...; Secure; ...' without their values."""
    found = []
    for headers in answers:
        for value in headers.get_all('Set-Cookie') or []:
            name, _, rest = value.partition('=')
            flags = [p.strip() for p in rest.split(';')[1:] if p.strip() and not p.strip().lower().startswith('expires')]
            found.append('; '.join([name.strip()] + flags))
    return found


def explain_cookies(found, url):
    secure = [c for c in found if re.search(r';\s*secure(;|$)', c, re.I)]
    if not found:
        return ['The login page set no session cookie, so OpenNMS cannot keep the CSRF token of this visit.']
    if secure and url.startswith('http:'):
        return ['The session cookie is marked Secure (%s), so a browser sends it back only over https.' % secure[0]]
    return ['Session cookie: %s' % '  |  '.join(found)]


def health(base, user, password):
    status, _, _, body = Browser().get(base + '/rest/health?t=30000', auth=user + ':' + password)
    try:
        data = json.loads(body)
    except ValueError:
        print('  (rest/health answered HTTP %s, not the list of checks)' % status)
        return 1
    if data.get('healthy'):
        print('  every health check passes')
        return 0
    bad = [r for r in data.get('responses') or [] if r.get('status') != 'Success']
    for r in bad[:15]:
        message = ' '.join((r.get('message') or '').split())
        print('  %s: %s%s' % (r.get('description'), r.get('status'), ' (%s)' % message[:150] if message else ''))
    if data.get('errorMessage'):
        print('  ' + data['errorMessage'])
    return 1


def nodes(base, user, password, public=None):
    status, _, _, body = Browser().get(base + '/rest/nodes?limit=0', auth=user + ':' + password, accept='application/json')
    try:
        found = json.loads(body).get('node') or []
    except ValueError:
        print('  Nodes          (rest/nodes answered HTTP %s)' % status)
        return 1
    groups = {}
    for n in found if isinstance(found, list) else [found]:
        groups.setdefault(n.get('foreignSource') or '(no requisition)', []).append(n.get('label') or n.get('id'))
    parts = []
    for source, labels in sorted(groups.items(), key=lambda kv: (kv[0] != 'DAS-Demo', kv[0])):
        if source == 'DAS-Demo':
            parts.append('%d in requisition DAS-Demo (the demo of the kit)' % len(labels))
            continue
        names = ', '.join(sorted(labels)[:5]) + (', ...' if len(labels) > 5 else '')
        where = 'without requisition' if source == '(no requisition)' else 'in requisition ' + source
        parts.append('%d %s: %s' % (len(labels), where, names))
    print('  Nodes          %d: %s' % (len(found) if isinstance(found, list) else 1, '; '.join(parts) or 'none'))
    orion = [n for n in (found if isinstance(found, list) else [found])
             if n.get('foreignSource') == 'DAS-Demo' and n.get('foreignId') == 'orion-1']
    if orion:  # the view opens on one node at zoom level 0; this link opens the DAS tree (TopologyLinkBuilder)
        print('  Path Outage    %s/topology?provider=Path%%20Outage&szl=2&focus-vertices=%s' % (public or base, orion[0]['id']))
    return 0


def page(base):
    b = Browser()
    try:
        status, url, answers, body = b.get(base + '/login.jsp')
    except Exception as e:  # no answer at all
        print('%s: no answer (%s)' % (base, getattr(e, 'reason', e)))
        return 3
    form, _ = login_form(body)
    if status != 200 or not form:
        print('%s/login.jsp: HTTP %s%s' % (base, status, ', no login form' if status == 200 else ''))
        return 1
    token = [n for _, t, n, _ in form['fields'] if t == 'hidden' and 'csrf' in n.lower()]
    print('%s/login.jsp: %s; %s' % (
        base, 'has a CSRF token field' if token else 'has NO CSRF token field',
        ' | '.join(cookies_set(answers)) or 'sets no session cookie'))
    return 0


def login(base, user, password):
    """Exit 0: works. 1: refused. 2: user or password refused. 3: no answer."""
    b = Browser()
    try:
        status, url, answers, body = b.get(base + '/login.jsp')
    except Exception as e:
        print('Login at %s: no answer (%s).' % (base, getattr(e, 'reason', e)))
        return 3
    form, href = login_form(body)
    if status != 200 or not form:
        print('Login at %s: the login page answered HTTP %s%s.' % (base, status, ' without a login form' if status == 200 else ''))
        return 1
    found = cookies_set(answers)
    fields, names = [], []
    for tag, kind, name, value in form['fields']:
        if not name or kind in ('submit', 'button', 'image', 'reset'):
            continue
        if kind == 'password':
            value = password
        elif name == 'j_username' or (kind in ('text', 'email') and not fields):
            value = user
        fields.append((name, value))
        names.append(name)
    token = [n for n in names if 'csrf' in n.lower()]
    action = urllib.parse.urljoin(urllib.parse.urljoin(url, href or ''), form['action'] or url)
    action = urllib.parse.quote(action, safe=":/?#[]@!$&'()*+,;=%")  # as a browser sends it
    status, after, answers2, body = b.get(action, data=urllib.parse.urlencode(fields).encode())
    if status == 200 and 'j_spring_security_check' not in after and not is_login_page(body, after):
        where = urllib.parse.urlsplit(after).path
        print('Login at %s: works (%s gets %s%s).' % (
            base, user, where, ', which asks to change the default password' if 'passwordGate' in where else ''))
        return 0
    if 'login_error' in after:
        reason = re.search(r'login-attempt-failed-reason">\s*Reason:\s*([^<]*)<', body)
        print('Login at %s: OpenNMS refused user %s or its password%s.' % (
            base, user, ' (%s)' % reason.group(1).strip() if reason else ''))
        print('  Set DEV_USER and DEV_PASSWORD in kit.env to an account of your image.')
        return 2
    if status == 200 and is_login_page(body, after):
        print('Login at %s: the user and password were accepted, but the next page asks to log in again:' % base)
        print('  the browser does not send the session cookie back.')
        for line in explain_cookies(found + cookies_set(answers2), after):
            print('  ' + line)
        return 1
    denied = status == 403 or 'Access denied' in body
    print('Login at %s: refused with %s.' % (base, 'OpenNMS\'s "Access denied" page (HTTP %s)' % status if denied else 'HTTP %s' % status))
    if denied:
        print('  OpenNMS 33 accepts a login only with the CSRF token that the login page put in the form.')
        if not token:
            print('  The login page has no CSRF token field: its form sends only %s.' % ', '.join(names))
        else:
            print('  OpenNMS keeps that token in the session of the visit, which needs the session cookie.')
            for line in explain_cookies(found, url):
                print('  ' + line)
    return 1


if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[1] not in ('health', 'nodes', 'login', 'page'):
        sys.exit(__doc__)
    command, args = sys.argv[1], sys.argv[2:]
    base = args[0].rstrip('/')
    try:
        if command == 'health':
            sys.exit(health(base, args[1], args[2]))
        if command == 'nodes':
            sys.exit(nodes(base, args[1], args[2], args[3].rstrip('/') if len(args) > 3 else None))
        if command == 'login':
            sys.exit(login(base, args[1], args[2]))
        sys.exit(page(base))
    except Exception as e:  # a network error in the middle: say so, do not stop the caller
        print('%s: %s' % (base, getattr(e, 'reason', e)))
        sys.exit(3)
