#!/usr/bin/env python3
"""Adds the CSRF token field to a login page that has none. Only ./dev.sh uses this, for the development OpenNMS.

OpenNMS 33.1.8 accepts a login (POST j_spring_security_check) only with the CSRF token of the login page, in the form
field _csrf (applicationContext-spring-security.xml, csrfMatcher, NMS-16369). The stock login.jsp has the field. A
login page without it gets OpenNMS's "Access denied" page for every login.

usage: csrf_fix.py <login.jsp> <output>
exit 0: written, with the field added. 1: nothing to add (it has a token field, or no login form). 2: cannot add it.
"""
import re
import sys

FIELD = ('<%-- Added by the topology kit, in the development OpenNMS only: OpenNMS 33.1.8 accepts a login only with'
         ' this token. --%>\n')
EL = '<input type="hidden" name="${_csrf.parameterName}" value="${_csrf.token}"/>'
SCRIPTLET = ('<% Object kitCsrf = request.getAttribute("_csrf"); if (kitCsrf instanceof '
             'org.springframework.security.web.csrf.CsrfToken) { %><input type="hidden" name="<%= '
             '((org.springframework.security.web.csrf.CsrfToken) kitCsrf).getParameterName() %>" value="<%= '
             '((org.springframework.security.web.csrf.CsrfToken) kitCsrf).getToken() %>"/><% } %>')


def tag_end(text, start):
    """The index of the '>' that ends the tag at start; quotes may hold '>' (action="<c:url .../>")."""
    quote = None
    for i in range(start + 1, len(text)):
        c = text[i]
        if quote:
            if c == quote:
                quote = None
        elif c in '"\'':
            quote = c
        elif c == '>':
            return i
    return -1


def main(source, target):
    text = open(source, encoding='utf-8', errors='surrogateescape').read()
    if '_csrf' in text:
        return 1
    for m in re.finditer(r'<form\b', text, re.I):
        end = tag_end(text, m.start())
        if end < 0:
            return 2
        close = text.lower().find('</form', end)
        body = text[end:close if close > 0 else len(text)]
        if 'j_spring_security_check' in text[m.start():end] or 'j_password' in body:
            ignored = re.search(r'isELIgnored\s*=\s*["\']true', text, re.I)
            field = '\n' + FIELD + (SCRIPTLET if ignored else EL)
            with open(target, 'w', encoding='utf-8', errors='surrogateescape') as out:
                out.write(text[:end + 1] + field + text[end + 1:])
            return 0
    return 1


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2]))
