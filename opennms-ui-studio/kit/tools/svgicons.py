#!/usr/bin/env python3
"""The icons of the svg files of an OpenNMS, the way the topology page uses them (GUIDE-node-icons.md, part 1).

OpenNMS draws a node with three <use> elements: <use href="#X"> (the normal look), <use href="#X_rollover"> (the
mouse is over the node) and <use href="#X_active"> (the node is selected). A <use> draws everything inside the element
with that id. The stock files put the three looks next to each other in a wrapper that nothing draws:
<g id="X_icon"> holding <g id="X">, <g id="X_rollover"> and <g id="X_active">. A file exported with the three looks
inside <g id="X"> (as X_default, X_rollover, X_active) is drawn wrong: <use href="#X"> draws all three, one over the
other, and the last one in the file covers the others (OpenNMS UI Studio's Icon files box repairs the usual case).

An icon id here is an id X of an element of the file that has X_rollover, X_active or X_icon next to it; the
groups X_rollover, X_active, X_icon and X_default themselves are not icon ids.

  svgicons.py ids <svg folder> [--own]       the icon ids, one per line (--own: not those of OpenNMS's own files)
  svgicons.py list <svg folder>              each file with its icon ids, and what is wrong with the way it is built
  svgicons.py pick <svg folder> <word> [<fallback>]
                                             the icon id for a word such as nimbus: the icon with that id, else one
                                             with the word as a part of its id (das_nimbus), else one that holds it,
                                             else <fallback>
"""
import re
import sys
from pathlib import Path

STOCK = {'opennms_icons.svg', 'atlas_icons.svg', 'vmware_icons.svg', 'legacy_icons.svg'}  # OpenNMS's own files
STYLE_PREFIX = 'zz-topology-styles'  # the style file of the kit and of the studio: CSS only
STATES = ('_rollover', '_active')
NOT_ICONS = ('_rollover', '_active', '_icon', '_default')

# Markup that holds no element (comments, CDATA, processing instructions, the doctype with its internal subset), and
# tags, whose attribute values may hold ">" when quoted.
TOKEN = re.compile(r'<!--.*?-->|<!\[CDATA\[.*?\]\]>|<\?.*?\?>|<!DOCTYPE(?:[^\[>]|\[.*?\])*>'
                   r'|<(/?)([A-Za-z_][\w:.-]*)((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>', re.S | re.I)
ID = re.compile(r'(?:^|\s)id\s*=\s*(?:"([^"]*)"|\'([^\']*)\')')


def scan(text):
    """[(id, ancestor ids)] of the elements with an id, in document order."""
    found, stack = [], []
    for m in TOKEN.finditer(text):
        if not m.group(2):
            continue  # comment, CDATA, processing instruction, doctype
        closing, tag, attrs = m.group(1), m.group(2), m.group(3) or ''
        if closing:
            for depth in range(len(stack) - 1, -1, -1):  # tolerate a missing end tag: close up to the matching one
                if stack[depth][0] == tag:
                    del stack[depth:]
                    break
            continue
        hit = ID.search(attrs)
        own = (hit.group(1) if hit.group(1) is not None else hit.group(2)) if hit else None
        if own:
            found.append((own, tuple(i for _, i in stack if i)))
        if not attrs.rstrip().endswith('/'):
            stack.append((tag, own))
    return found


class SvgFile:
    def __init__(self, path, text=None):
        self.path = Path(path)
        self.name = self.path.name
        self.stock = self.name in STOCK
        text = self.path.read_text(errors='replace') if text is None else text
        self.elements = scan(text)
        self.ids = {i for i, _ in self.elements}
        self.parents = {}
        for i, anc in self.elements:
            self.parents.setdefault(i, anc)
        self.icons = sorted(i for i in self.ids
                            if not i.endswith(NOT_ICONS) and any(i + s in self.ids for s in STATES + ('_icon',)))

    def stacked(self, icon):
        """The looks that lie inside the icon's own group (drawn on top of each other), in file order."""
        inside = [s for s in (icon + '_default', icon + '_rollover', icon + '_active') if icon in self.parents.get(s, ())]
        order = {i: n for n, (i, _) in enumerate(self.elements)}
        return sorted(inside, key=lambda s: order.get(s, 0))

    def problems(self):
        """Sentences: what OpenNMS draws differently from what the file means."""
        out = []
        for icon in self.icons:
            stacked = self.stacked(icon)
            if stacked:
                out.append('icon %s: the group %s holds %s, so a node draws them on top of each other and shows %s, '
                           'the last one; a CSS rule for the others changes nothing you see. OpenNMS wants %s next to %s, '
                           'in a group %s_icon (OpenNMS UI Studio > Topology > Icon files explains it and repairs the usual case)'
                           % (icon, icon, ', '.join(stacked), stacked[-1], ' and '.join(icon + s for s in STATES), icon, icon))
            missing = [icon + s for s in STATES if icon + s not in self.ids]
            if missing:
                out.append('icon %s has no %s: that look is not drawn, the node keeps its normal look then'
                           % (icon, ' and no '.join(missing)))
        for i in sorted(self.ids):
            if i.endswith('_icon') and i[:-5] not in self.ids:
                out.append('%s has no group %s: a node with the icon %s shows nothing' % (i, i[:-5], i[:-5]))
            if i.endswith('_default') and i[:-8] not in self.ids:
                out.append('%s: OpenNMS draws %s, never %s; rename the group to %s' % (i, i[:-8], i, i[:-8]))
        return out


def svg_files(folder, own=False):
    out = []
    for path in sorted(Path(folder).glob('*.svg')):
        if path.name.startswith(STYLE_PREFIX) or (own and path.name in STOCK):
            continue
        try:
            out.append(SvgFile(path))
        except OSError:
            continue
    return out


def icon_ids(folder, own=False):
    return sorted({i for f in svg_files(folder, own) for i in f.icons})


def all_ids(folder):
    """Every id of every svg file: <use href="#X"> draws any element with the id X."""
    return {i for f in svg_files(folder) for i in f.ids}


def pick(folder, word, icons=None):
    """The icon id for a word (a node type such as nimbus), or None."""
    icons = icon_ids(folder) if icons is None else sorted(icons)
    w = word.lower()
    token = re.compile(r'(?:^|[_.-])' + re.escape(w) + r'(?:$|[_.-])')
    for test in (lambda i: i.lower() == w, lambda i: token.search(i.lower()), lambda i: w in i.lower()):
        hit = next((i for i in icons if test(i)), None)
        if hit:
            return hit
    return None


def similar(word, icons):
    """Up to three icon ids that hold the word: das_helix for helix."""
    return sorted(i for i in icons if word.lower() in i.lower() and i != word)[:3]


def main(argv):
    if len(argv) >= 2 and argv[0] == 'ids':
        for i in icon_ids(argv[1], own='--own' in argv[2:]):
            print(i)
        return 0
    if len(argv) == 2 and argv[0] == 'list':
        for f in svg_files(argv[1]):
            shown = ', '.join(f.icons) if len(f.icons) <= 12 else '%d icons: %s, ...' % (len(f.icons), ', '.join(f.icons[:8]))
            print('%-26s %s' % (f.name, shown or '(no icon)'))
            if not f.stock:
                for p in f.problems():
                    print('  ! ' + p)
        return 0
    if len(argv) in (3, 4) and argv[0] == 'pick':
        print(pick(argv[1], argv[2]) or (argv[3] if len(argv) == 4 else ''))
        return 0
    sys.stderr.write(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
