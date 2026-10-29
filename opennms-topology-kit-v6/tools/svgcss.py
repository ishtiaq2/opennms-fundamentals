#!/usr/bin/env python3
"""./topo.sh css: CSS for the parts of an icon, so that its svg file can stay as it is.

OpenNMS 33.1.8 puts every svg file of jetty-webapps/opennms/svg into the topology page: the server lists the folder
(IconRepositoryManager.getSVGIconFiles) and the page appends each whole file to its <defs> (D3.injectSVGDef). A <style>
block of a file therefore applies to the whole page. A node is drawn with <use class="upIcon" xlink:href="#<icon id>">,
with "#<icon id>_rollover" under the mouse (use.overIcon) and "#<icon id>_active" when selected (use.activeIcon)
(GWTVertex). A rule "#<icon id> .cls-1" styles one part of one icon: the id makes it win over the file's own ".cls-1"
rule, and over a ".cls-1" rule of another file, whatever order the browser loads the files in.

  svgcss.py overview <svg folder>
  svgcss.py rules <svg folder> <file.svg | icon id> <dev url> <prod url>
  svgcss.py main <svg folder> <icon id>    (examples/12: the selector of the main colour of each drawing)
  svgcss.py count <css file>
"""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

OURS = 'zz-topology-styles'
STOCK = {'opennms_icons.svg', 'atlas_icons.svg', 'vmware_icons.svg', 'legacy_icons.svg'}
STATES = (('', 'as it normally shows', 'upIcon'), ('_rollover', 'under the mouse', 'overIcon'),
          ('_active', 'when the node is selected', 'activeIcon'))
COLOURS = ('fill', 'stroke', 'stop-color')


def local(tag):
    return tag.rsplit('}', 1)[-1] if isinstance(tag, str) else ''


def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def declarations(body):
    """'fill:#fff;stroke : red' -> 'fill: #fff; stroke: red;'"""
    out = []
    for part in body.split(';'):
        if ':' in part:
            prop, value = part.split(':', 1)
            if prop.strip() and value.strip():
                out.append('%s: %s' % (prop.strip(), ' '.join(value.split())))
    return '; '.join(out) + (';' if out else '')


def css_rules(css):
    """[(selector list, declarations)] of the plain rules of a style sheet; @-rules are left out."""
    css, rules, i = strip_comments(css), [], 0
    while True:
        j = css.find('{', i)
        if j < 0:
            return rules
        depth, k = 1, j + 1
        while k < len(css) and depth:
            depth += {'{': 1, '}': -1}.get(css[k], 0)
            k += 1
        head = css[i:j]
        if '@' in head and ';' in head:  # "@import ...; .a" or "@charset ...; .a"
            head = head.rsplit(';', 1)[1]
        head = ' '.join(head.split())
        if head and not head.startswith('@'):
            rules.append((head, declarations(css[j + 1:k - 1])))
        i = k


def split_list(head):
    """'.a, .b:is(.c, .d)' -> ['.a', '.b:is(.c, .d)']"""
    out, depth, cur = [], 0, ''
    for ch in head:
        depth += {'(': 1, '[': 1, ')': -1, ']': -1}.get(ch, 0)
        if ch == ',' and depth == 0:
            out.append(cur.strip())
            cur = ''
        else:
            cur += ch
    return [s for s in out + [cur.strip()] if s]


def subject(selector):
    """The last compound selector: (element name or '', {classes}, has an id)."""
    last = re.split(r'\s*[>+~]\s*|\s+', re.sub(r'\([^)]*\)|\[[^\]]*\]', '', selector).strip())[-1]
    tag = re.match(r'^[a-zA-Z][\w-]*', last)
    return (tag.group(0).lower() if tag else ''), set(re.findall(r'\.(-?[_a-zA-Z][\w-]*)', last)), '#' in last


class SvgFile:
    def __init__(self, path):
        self.path, self.name = path, path.name
        self.text = path.read_text(errors='replace')
        self.root, self.error = None, None
        try:
            self.root = ET.fromstring(self.text.encode('utf-8'))
        except ET.ParseError as e:
            self.error = str(e)
        self.by_id = {}
        style = ''
        if self.root is not None:
            for el in self.root.iter():
                if el.get('id'):
                    self.by_id.setdefault(el.get('id'), el)
                if local(el.tag) == 'style':
                    style += ''.join(el.itertext()) + '\n'
        else:  # not XML: OpenNMS cannot read it either; keep what a regex finds
            style = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', self.text, flags=re.S))
            style = style.replace('<![CDATA[', '').replace(']]>', '')
        self.rules = css_rules(style)

    def icons(self):
        """The icon ids of the file: <g id="X_icon"> (the OpenNMS way), or X with an X_rollover or X_active, or
        else every <g id> at the top of the file."""
        ids = list(self.by_id)
        found = [i[:-5] for i in ids if i.endswith('_icon') and i[:-5] in self.by_id]
        found += [i for i in ids if i not in found and (i + '_rollover' in self.by_id or i + '_active' in self.by_id)]
        if not found and self.root is not None:
            found = [el.get('id') for el in self.root if local(el.tag) == 'g' and el.get('id')]
        return found

    def global_rules(self):
        """Rules whose subject has no class and no id: they style every such element of the page."""
        return [(h, d) for h, d in self.rules if any(not subject(s)[1] and not subject(s)[2] for s in split_list(h))]


def load(folder):
    return [SvgFile(f) for f in sorted(Path(folder).glob('*.svg')) if not f.name.startswith(OURS)]


def overview(folder):
    files = load(folder)
    print('The svg files in %s:' % folder)
    print('OpenNMS puts every one of them into the topology page, and the <style> block of each applies to the whole page.')
    for f in files:
        icons = f.icons()
        shown = ', '.join(icons) if len(icons) <= 6 else '%d icons: %s, ...' % (len(icons), ', '.join(icons[:4]))
        rules = len(f.rules)
        print('  %-24s %s%s%s' % (f.name, (shown if len(icons) > 6 else ('icon ' if len(icons) == 1 else 'icons ') + shown)
                                 if icons else 'no icon',
                                 '; %d style rule%s' % (rules, '' if rules == 1 else 's') if rules else '; no <style>',
                                 ' (stock)' if f.name in STOCK else ''))
        if f.error:
            print('    ! not XML (%s): the page cannot read it' % f.error)
    seen = {}
    for f in files:
        for head, body in f.rules:
            for s in split_list(head):
                tag, classes, has_id = subject(s)
                if classes and not has_id and re.fullmatch(r'\.[\w-]+', s):
                    seen.setdefault(s, {}).setdefault(body, []).append(f.name)
    clashes = {s: v for s, v in seen.items() if len(v) > 1}
    own = {s: v for s, v in clashes.items() if any(n not in STOCK for names in v.values() for n in names)}
    if own:
        print('\nClass rules that several files define differently. The browser applies the one of the file it loads last')
        print('to every element with that class, in every icon, so an icon can show colours of another file:')
        width = max(len(s) for s in own)
        for s, v in sorted(own.items(), key=lambda kv: (len(kv[0]), kv[0])):
            print('  %-*s  %s' % (width, s, '  |  '.join('%s: %s' % (', '.join(n), b) for b, n in v.items())))
        print('  ./topo.sh css <file> prints the same rules with the id of each icon in front: they hit that icon only.')
    for f in files:
        for head, body in f.global_rules():
            print('  ! %s: "%s { %s }" styles every element of that kind on the page (links and labels too)'
                  % (f.name, head, body))
    print('\n./topo.sh css <file.svg | icon id> prints CSS for the parts of one icon (GUIDE-Maven-abc-styles.md, step 7).')


def find(folder, what):
    """(file, [icon ids]) for a file name, a file name without .svg, or an icon id."""
    files = load(folder)
    for f in files:
        if what in (f.name, f.path.stem):
            return f, f.icons()
    base = re.sub(r'_(rollover|active|icon)$', '', what)
    for f in files:
        if base in f.by_id or what in f.by_id:
            return f, [base if base in f.by_id else what]
    near = sorted({f.name for f in files if what.lower() in f.name.lower()} |
                  {i for f in files for i in f.icons() if what.lower() in i.lower()})[:8]
    sys.exit('No svg file in %s is called %s or defines the id "%s".%s ./topo.sh css lists the files and icons.'
             % (folder, what, what, ' Similar: ' + ', '.join(near) + '.' if near else ''))


def state_rules(f, sid):
    """The lines of CSS for one drawing (<g id=sid>): the file's class rules, then its colour attributes."""
    el, lines = f.by_id[sid], []
    elements = list(el.iter())
    for head, body in f.rules:
        picked = []
        for s in split_list(head):
            tag, classes, has_id = subject(s)
            if has_id or not classes and not tag:
                continue
            if any((not tag or local(e.tag).lower() == tag) and classes <= set((e.get('class') or '').split())
                   for e in elements):
                picked.append('#%s %s' % (sid, s))
        if picked:
            lines.append('%s { %s }' % (', '.join(picked), body))
    for prop in COLOURS:
        values = []
        for e in elements:
            v = e.get(prop)
            if v and v not in values and v.lower() not in ('none', 'inherit', 'currentcolor') and not v.startswith('url('):
                values.append(v)
        for v in values:
            lines.append('#%s [%s="%s" i] { %s: %s; }' % (sid, prop, v, prop, v))
    inline = []
    for e in elements:
        for part in (e.get('style') or '').split(';'):
            if ':' in part:
                prop, value = (x.strip() for x in part.split(':', 1))
                if (prop in COLOURS and value and not value.startswith('url(') and part.strip() not in inline
                        and value.lower() not in ('none', 'inherit', 'currentcolor')):
                    inline.append(part.strip())
                    lines.append('#%s [style*="%s" i] { %s: %s !important; }' % (sid, part.strip(), prop, value))
    return lines


def rules(folder, what, dev_url, prod_url):
    f, icons = find(folder, what)
    if f.error:
        print('/* ! %s is not XML (%s): the topology page cannot read it, so no rule can style it. */' % (f.name, f.error))
        return
    print('/* %s: CSS for %s %s, made by ./topo.sh css from the file. The file stays as it is.' % (
        f.name, 'its icon' if len(icons) == 1 else 'its icons', ', '.join(icons) or '(none)'))
    print('   This machine: opennms/jetty-webapps/opennms/svg/%s' % f.name)
    print('   In OpenNMS:   /opt/opennms/jetty-webapps/opennms/svg/%s, in the browser %s/svg/%s' % (f.name, dev_url, f.name))
    print('                 (production: %s/svg/%s)' % (prod_url.rstrip('/'), f.name))
    print('   Each rule starts with the id of one drawing, so it styles that icon only and wins over the rule of the file.')
    print('   Copy what you want to change into styles/topology.css, then change the values. */')
    if not icons:
        print('/* ! This file has no drawing with an id: OpenNMS cannot draw an icon from it. */')
    for x in icons:
        drawn = [x + suffix for suffix, _, _ in STATES if x + suffix in f.by_id]
        inner = [d for d in drawn[1:] if any(e is f.by_id[d] for e in f.by_id[x].iter())]
        if inner:
            print('\n/* ! #%s holds %s: OpenNMS draws all of it as the normal icon, one drawing over the other. Each'
                  % (x, ' and '.join('#' + d for d in inner)))
            print('     state wants its own <g id> next to the others, like opennms_icons.svg: <g id="%s_icon"> with'
                  ' <g id="%s">, <g id="%s_rollover"> and <g id="%s_active">. */' % (x, x, x, x))
        for other in ('_default', '_normal'):
            if x + other in f.by_id:
                print('\n/* ! OpenNMS draws #%s, never #%s%s. */' % (x, x, other))
        for suffix, when, cls in STATES:
            sid = x + suffix
            if sid not in f.by_id:
                if suffix:
                    print('\n/* %s %s: the file has no #%s, so nothing changes then. */' % (x, when, sid))
                continue
            print('\n/* %s %s: <use class="%s" xlink:href="#%s"> */' % (x, when, cls, sid))
            lines = state_rules(f, sid)
            print('\n'.join(lines) if lines else '/* (no class and no colour attribute to override in #%s) */' % sid)
        node = 'svg .vertex:has(use.upIcon[*|href="#%s"])' % x
        print('\n/* Every node drawn with %s. Take out the comment marks of what you want (step 7 of the guide). */' % x)
        print('/* Frame 2 px wide (in the alarm colour) and a white background behind the drawing: */')
        print('/* %s > rect.status { stroke-width: 2px; fill: #ffffff; rx: 4px; } */' % node)
        print('/* A border that follows the outline of the drawing, 1 px dark blue: */')
        print('/* %s > .icon-container { filter: drop-shadow(1px 0 0 #1F3A5F) drop-shadow(-1px 0 0 #1F3A5F)'
              ' drop-shadow(0 1px 0 #1F3A5F) drop-shadow(0 -1px 0 #1F3A5F); } */' % node)
        print('/* The drawing 25 % bigger, with its frame; the label moves down: */')
        print('/* %s > :is(.icon-container, rect.status, rect.svgIconOverlay) { scale: 1.25; } */' % node)
        print('/* %s > text.vertex-label { translate: 0 6px; } */' % node)
        print('/* Sharper or softer edges, more contrast: */')
        print('/* %s > .icon-container { shape-rendering: crispEdges; filter: contrast(1.3); } */' % node)
        print('/* Its label: */')
        print('/* %s > text.vertex-label { fill: #1F3A5F; font-weight: bold; } */' % node)
    images = sum(1 for e in f.root.iter() if local(e.tag) == 'image')
    if images:
        print('\n/* ! %s holds %d bitmap image(s) (<image>): CSS can only filter, scale or hide those as a whole. */'
              % (f.name, images))
    for head, body in f.global_rules():
        print('/* ! The file\'s rule "%s { %s }" styles every element of that kind on the page. */' % (head, body))


WHITE = {'#fff', '#ffffff', 'white', 'none', 'transparent'}


def main_colour(f, sid, others):
    """The selector of the colour that most parts of one drawing have (white and none left out), preferring a colour
    that the other drawings of the icon (others: their ids) do not use: the one that tells this state apart."""
    fills = {}
    for head, body in f.rules:
        m = re.search(r'(?:^|;)\s*fill:\s*([^;]+)', body)
        for s in split_list(head):
            if m and re.fullmatch(r'\.[\w-]+', s):
                fills[s[1:]] = m.group(1).strip().lower()

    def keys(el):
        out = []
        for e in el.iter():
            for c in (e.get('class') or '').split():
                if c in fills and fills[c] not in WHITE and not fills[c].startswith('url('):
                    out.append('.' + c)
            v = e.get('fill') or ''
            if v and v.lower() not in WHITE and not v.startswith('url('):
                out.append('[fill="%s" i]' % v)
        return out

    mine = keys(f.by_id[sid])
    if not mine:
        return ''
    elsewhere = {k for o in others if o in f.by_id and o != sid for k in keys(f.by_id[o])}
    best = sorted(dict.fromkeys(mine), key=lambda k: (k in elsewhere, -mine.count(k), mine.index(k)))[0]
    return '#%s %s' % (sid, best)


def main(folder, icon):
    f, _ = find(folder, icon)
    ids = [icon + suffix for suffix, _, _ in STATES]
    for sid in ids:
        print(main_colour(f, sid, ids) if f.root is not None and sid in f.by_id else '')


def count(css_file):
    try:
        text = Path(css_file).read_text(errors='replace')
    except OSError:
        text = ''
    print(len(css_rules(text)))


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['overview'] and len(a) == 2:
        overview(a[1])
    elif a[:1] == ['rules'] and len(a) == 5:
        rules(*a[1:])
    elif a[:1] == ['main'] and len(a) == 3:
        main(a[1], a[2])
    elif a[:1] == ['count'] and len(a) == 2:
        count(a[1])
    else:
        sys.exit(__doc__)
