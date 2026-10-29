#!/usr/bin/env python3
"""GraphML views (entries of the View menu) for ./topo.sh view. FILES.md, section 5, explains them.

  graphml.py check <file> <svg folder> [<other view files>...]
      what the view holds; exit 1 when OpenNMS would refuse it (GraphMLReader in OpenNMS 33.1.8: keys, ids,
      links) or not load it (a graph without namespace, or a namespace another view uses). Icon keys that no
      svg file defines are reported: such nodes get no icon.
  graphml.py label <file> <default>
      the label the View menu shows: the label of <graphml>, else <default>
  graphml.py prepare <in> <out> <svg folder>
      copies <in> to <out>, with @orion@, @helix@, ... (any @word@) replaced by the icon id of that word in the svg
      folder: the same id, else an id that contains the word
"""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = '{http://graphml.graphdrawing.org/xmlns}'
TYPES = {'boolean', 'int', 'long', 'float', 'double', 'string'}
TAKEN = {'nodes', 'pathoutage', 'application', 'bsm', 'vmware'}  # namespaces of the stock views


def icon_ids(svg_folder):
    ids = set()
    for f in Path(svg_folder).glob('*.svg'):
        ids.update(re.findall(r'id="([^"]+)_icon"', f.read_text(errors='replace')))
    return ids


def properties(root, element, kind):
    """{attr.name: text} of the <data> children of element; kind is graphml, graph, node or edge."""
    keys = {}
    for key in root.iter(NS + 'key'):
        if key.get('for') in (kind, 'all') or key.get('id') not in keys:
            keys[key.get('id')] = key.get('attr.name') or key.get('id')
    return {keys.get(d.get('key'), d.get('key')): (d.text or '').strip() for d in element.findall(NS + 'data')}


def read(path):
    root = ET.parse(path).getroot()
    if root.tag != NS + 'graphml':
        raise ValueError('%s: the root element is not <graphml> of %s' % (path, NS[1:-1]))
    graphs = []
    for graph in root.findall(NS + 'graph'):
        props = properties(root, graph, 'graph')
        nodes = [properties(root, n, 'node') for n in graph.findall(NS + 'node')]
        graphs.append({'id': graph.get('id'), 'props': props, 'nodes': nodes, 'edges': len(graph.findall(NS + 'edge'))})
    return root, graphs


def rules(root):
    """What GraphMLReader (OpenNMS 33.1.8) refuses: the problems, as sentences."""
    problems, types, node_ids = [], {}, set()
    for key in root.iter(NS + 'key'):
        types.setdefault(key.get('id'), set()).add(key.get('attr.type'))
    for key_id, kinds in types.items():
        if key_id == 'id':
            problems.append('a <key> may not have the id "id"')
        if len(kinds) > 1:
            problems.append('the keys with id %s have different attr.type values' % key_id)
        if not kinds <= TYPES:
            problems.append('key %s: attr.type must be one of %s' % (key_id, ', '.join(sorted(TYPES))))
    for data in root.iter(NS + 'data'):
        if data.get('key') not in types:
            problems.append('<data key="%s"> has no <key id="%s">' % (data.get('key'), data.get('key')))
    graph_ids = set()
    for graph in root.findall(NS + 'graph'):
        if graph.get('id') in graph_ids:
            problems.append('two graphs have the id %s' % graph.get('id'))
        graph_ids.add(graph.get('id'))
        if not graph.get('edgedefault'):
            problems.append('graph %s: add edgedefault="undirected"' % graph.get('id'))
        for kind in ('node', 'edge'):
            seen = set()
            for element in graph.findall(NS + kind):
                if element.get('id') in seen:
                    problems.append('graph %s has two %ss with the id %s' % (graph.get('id'), kind, element.get('id')))
                seen.add(element.get('id'))
        node_ids |= {n.get('id') for n in graph.findall(NS + 'node')}
    for edge in root.iter(NS + 'edge'):
        for end in ('source', 'target'):
            if edge.get(end) not in node_ids:
                problems.append('link %s: %s %s is no node of any graph' % (edge.get('id'), end, edge.get(end)))
    return sorted(set(problems))


def check(path, svg_folder, others):
    root, graphs = read(path)
    label = properties(root, root, 'graphml').get('label')
    used = {ns: 'a stock view' for ns in TAKEN}
    for other in others:
        try:
            for g in read(other)[1]:
                used[g['props'].get('namespace')] = Path(other).name
        except Exception:  # a broken other view is not this one's problem
            pass
    ids, problems, missing = icon_ids(svg_folder), rules(root), set()
    print('  View menu label: %s' % (label or '(none: the name of the view)'))
    for g in graphs:
        ns = g['props'].get('namespace')
        print('  layer %s: namespace %s, %d nodes, %d links, focus %s' % (
            g['props'].get('label') or g['id'], ns or '(none)', len(g['nodes']), g['edges'],
            g['props'].get('focus-strategy', 'FIRST')))
        if not ns:
            problems.append('graph %s has no namespace (<data key="namespace">); OpenNMS does not load it' % g['id'])
        elif ns in used:
            problems.append('namespace %s is used by %s already; namespaces must be unique' % (ns, used[ns]))
        for n in g['nodes']:
            if n.get('iconKey') and ids and n['iconKey'] not in ids:
                missing.add(n['iconKey'])
            if bool(n.get('foreignSource')) != bool(n.get('foreignID')):
                problems.append('node %s: foreignSource and foreignID go together' % n.get('label'))
    if not graphs:
        problems.append('there is no <graph>')
    if missing:
        print('  icon keys that no svg file defines (those nodes get no icon): %s' % ', '.join(sorted(missing)))
    for p in problems:
        print('  problem: ' + p)
    return 1 if problems else 0


def prepare(source, target, svg_folder):
    ids = sorted(icon_ids(svg_folder))
    text = Path(source).read_text()
    told = set()

    def icon(m):
        word = m.group(1).lower()
        found = next((i for i in ids if i.lower() == word), None) or next((i for i in ids if word in i.lower()), None)
        if not found and word not in told:
            print('  no icon for @%s@ in the svg folder: left as it is' % m.group(1))
            told.add(word)
        return found or m.group(0)

    Path(target).write_text(re.sub(r'@([A-Za-z][A-Za-z0-9_-]*)@', icon, text))
    return 0


if __name__ == '__main__':
    a = sys.argv[1:]
    try:
        if len(a) >= 3 and a[0] == 'check':
            sys.exit(check(a[1], a[2], a[3:]))
        if len(a) == 3 and a[0] == 'label':
            root = read(a[1])[0]
            print(properties(root, root, 'graphml').get('label') or a[2])
            sys.exit(0)
        if len(a) == 4 and a[0] == 'prepare':
            sys.exit(prepare(a[1], a[2], a[3]))
    except (ET.ParseError, ValueError, OSError) as e:
        print('  problem: %s' % e)
        sys.exit(1)
    sys.exit(__doc__)
