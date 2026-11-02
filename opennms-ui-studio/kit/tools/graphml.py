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
  graphml.py show <file> <svg folder> <etc folder>
      the layers and nodes of a view: node id, label, icon key, the icon OpenNMS draws (a "<namespace>.<node id>"
      line in an icon mapping file of <etc folder> wins over the icon key: IconRepositoryManager.getSVGIconId);
      lines that name a node of the view with another namespace are reported: OpenNMS ignores them
  graphml.py icon <file> <icon mapping file> <svg folder> <node id> <icon id | --reset>
      writes the line "<namespace>.<node id> = <icon id>" into the icon mapping file (the namespace is the one of
      the node's layer, a colon is escaped); --reset takes the line out again
  graphml.py used <etc folder> <svg folder>
      the icon ids that the nodes of all the views in <etc folder>/graphml are drawn with (an svg file must define
      them), one per line, in alphabetical order: the ids to give a colour of their own (examples/13)
  graphml.py from-requisition <requisition.xml> <icon-types.cfg> <svg folder> <view name> <out>
      a GraphML view of the nodes of a requisition (etc/imports/<name>.xml): each node linked to its OpenNMS node by
      foreignSource and foreignID, drawn under its parent node, with the icon of its type (icon-types.cfg; the type is
      the first category of the node that the table names, else its asset category or modelNumber, else the word
      its label starts with). GUIDE-node-icons.md, part 4.

The icon of a GraphML node (IconRepositoryManager.getSVGIconId, GraphMLIconRepository in OpenNMS 33.1.8): a line
"<namespace>.<node id> = <icon id>" in an icon mapping file, else the iconKey itself (every view answers for its own
icon keys, unchanged: a key is never shortened), else the "default" line. A mapping file line for the iconKey itself
competes with the view's own answer, and OpenNMS asks them in no fixed order: show warns about such lines.
"""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

import svgicons  # tools/svgicons.py: which ids of the svg files are icons

NS = '{http://graphml.graphdrawing.org/xmlns}'
TYPES = {'boolean', 'int', 'long', 'float', 'double', 'string'}
TAKEN = {'nodes', 'pathoutage', 'application', 'bsm', 'vmware'}  # namespaces of the stock views


def icon_ids(svg_folder):
    """The icon ids of the svg files: X with X_rollover, X_active or X_icon next to it (tools/svgicons.py)."""
    return set(svgicons.icon_ids(svg_folder))


def defined_ids(svg_folder):
    """Every id="..." of the svg files. OpenNMS draws a node with <use href="#<icon id>"> (GWTVertex): any element
    with that id will do, so this is what an icon id must be in (icon_ids lists the ones that are icons)."""
    ids = set()
    for f in Path(svg_folder).glob('*.svg'):
        ids.update(m.group(2) for m in re.finditer(r'(?<![\w:.-])id\s*=\s*(["\'])(.*?)\1', f.read_text(errors='replace')))
    return ids


def similar(word, ids):
    """Up to three icon ids that contain word: das_helix for helix."""
    return svgicons.similar(word, ids)


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
        nodes = [dict(properties(root, n, 'node'), id=n.get('id')) for n in graph.findall(NS + 'node')]
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
    ids, problems, missing = defined_ids(svg_folder), rules(root), set()
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


def split_property(raw):
    """(key, value) of a line of a java.util.Properties file, None for a blank or comment line: '=' ':' or blanks
    follow the key, a backslash escapes the next character."""
    line = raw.lstrip()
    if not line or line[0] in '#!':
        return None
    key, i = '', 0
    while i < len(line) and line[i] not in '=: \t\f':
        if line[i] == '\\' and i + 1 < len(line):
            i += 1
        key += line[i]
        i += 1
    value = line[i:].lstrip(' \t\f')
    if value[:1] in ('=', ':'):
        value = value[1:]
    return key, value.strip()


def java_properties(path):
    out = {}
    for raw in Path(path).read_text(errors='replace').splitlines():
        kv = split_property(raw)
        if kv:
            out[kv[0]] = kv[1]
    return out


def escaped(key):
    """A key as a mapping file must spell it: a colon, an equals sign or a blank needs a backslash."""
    return re.sub(r'([\\:= ])', r'\\\1', key)


def load_maps(etc_folder):
    """{key: (icon id, file name)} of the icon mapping files in etc_folder."""
    maps = {}
    for f in sorted(Path(etc_folder).glob('org.opennms.features.topology.app.icons.*.cfg')):
        for k, v in java_properties(f).items():
            maps.setdefault(k, (v, f.name))
    return maps


def icon_of(ns, node, maps):
    """(icon id, why) OpenNMS draws for a node: the line for the node, else its iconKey, else the default icon."""
    key = '%s.%s' % (ns, node['id'])
    if key in maps:
        return maps[key][0], 'the line %s in %s' % (escaped(key), maps[key][1])
    if node.get('iconKey'):
        return node['iconKey'], 'its iconKey'
    return maps.get('default', ('generic', ''))[0], 'default'


def other_namespaces(etc_folder, name):
    """The namespaces of the views in etc_folder/graphml, except the view name."""
    found = set()
    for f in Path(etc_folder, 'graphml').glob('*.xml'):
        if f.stem != name:
            try:
                found |= {g['props'].get('namespace') for g in read(f)[1]}
            except Exception:  # a broken other view is not this one's problem
                pass
    return found


def stray_lines(graphs, maps, others):
    """[(node id, sentence)] for the mapping lines that OpenNMS ignores in this view: the namespace of the line is not
    the one of the view (the usual slip: the namespace of an example), or the node id is not in the view."""
    by_ns = {g['props'].get('namespace'): {n['id'] for n in g['nodes']} for g in graphs}
    found = []
    for key, (icon, file) in sorted(maps.items()):
        prefix, _, rest = key.partition('.')
        if rest and prefix in by_ns and rest not in by_ns[prefix]:
            found.append((rest, 'the line "%s" in %s names no node of the namespace %s' % (escaped(key), file, prefix)))
        elif rest and prefix not in by_ns and prefix not in others and any(rest in ids for ids in by_ns.values()):
            ns = next(n for n, ids in by_ns.items() if rest in ids)
            right = '%s.%s' % (escaped(ns), rest)
            hint = ('Delete it: the line "%s" is there.' if '%s.%s' % (ns, rest) in maps else 'The line "%s" would work.') % right
            found.append((rest, 'the line "%s" in %s does nothing: the namespace of this view is %s. %s'
                          % (escaped(key), file, ns, hint)))
    return found


def show(path, svg_folder, etc_folder):
    root, graphs = read(path)
    name = Path(path).stem
    icons, defined, maps = icon_ids(svg_folder), defined_ids(svg_folder), load_maps(etc_folder)
    print('View menu label: %s' % (properties(root, root, 'graphml').get('label') or '(none: the name of the view)'))
    for g in graphs:
        p, ns = g['props'], g['props'].get('namespace', '?')
        print('Layer "%s": namespace %s; %d nodes, %d links; layout %s, focus %s, zoom level %s, status %s' % (
            p.get('label') or g['id'], ns, len(g['nodes']), g['edges'], p.get('preferred-layout', 'D3 Layout'),
            p.get('focus-strategy', 'FIRST'), p.get('semantic-zoom-level', '1'), p.get('vertex-status-provider', 'none')))
        print('  %-16s %-28s %-20s %s' % ('node id', 'label', 'iconKey', 'icon drawn'))
        for n in g['nodes'][:300]:
            drawn, why = icon_of(ns, n, maps)
            flag = ''
            if defined and drawn not in defined:
                near = similar(drawn, icons)
                flag = ' ! no svg file defines "%s": no icon%s' % (drawn, '; similar ids: ' + ', '.join(near) if near else '')
            key = n.get('iconKey')
            if why == 'its iconKey' and key in maps and maps[key][0] != key:
                flag += (' ! %s has the line "%s = %s" too: OpenNMS takes either that or the iconKey, in no fixed order'
                         ' (a line for the node, "%s.%s = ...", is certain)' % (maps[key][1], escaped(key), maps[key][0],
                                                                               escaped(ns), n['id']))
            print('  %-16s %-28s %-20s %s (%s)%s' % (n['id'], (n.get('label') or '')[:28], n.get('iconKey') or '-',
                                                  drawn, why, flag))
        if len(g['nodes']) > 300:
            print('  ... and %d more' % (len(g['nodes']) - 300))
    print('  Another icon for one node: ./topo.sh view icon %s <node id> <icon id>' % name)
    print('  (it writes the line "%s.<node id> = <icon id>" in opennms/etc/org.opennms.features.topology.app.icons.default.cfg)'
          % escaped(graphs[0]['props'].get('namespace', '<namespace>') if graphs else '<namespace>'))
    for message in stray_lines(graphs, maps, other_namespaces(etc_folder, name)):
        print('  ! ' + message[1])
    return 0


def used(etc_folder, svg_folder):
    """Print the icon ids that the nodes of the views in etc_folder/graphml are drawn with and that an svg file defines."""
    defined, maps = defined_ids(svg_folder), load_maps(etc_folder)
    found = set()
    for f in sorted(Path(etc_folder, 'graphml').glob('*.xml')):
        try:
            graphs = read(f)[1]
        except (ET.ParseError, ValueError, OSError):  # a broken view is not the business of this list
            continue
        for g in graphs:
            ns = g['props'].get('namespace', '')
            found.update(icon_of(ns, n, maps)[0] for n in g['nodes'])
    for icon in sorted(found & defined):
        print(icon)
    return 0


def set_icon(path, cfg, svg_folder, node_id, icon_id):
    """The line for one node in the icon mapping file cfg; icon_id --reset takes it out."""
    root, graphs = read(path)
    name = Path(path).stem
    hits = [(g, n) for g in graphs for n in g['nodes'] if n['id'] == node_id]
    if not hits:
        ids = [n['id'] for g in graphs for n in g['nodes']]
        print('  problem: the view %s has no node %s. Its node ids: %s%s' % (name, node_id, ', '.join(ids[:30]),
                                                                          ', ...' if len(ids) > 30 else ''))
        return 1
    if len(hits) > 1:
        print('  problem: node %s is in %d layers of the view %s: write the lines yourself (FILES.md, section 2)'
              % (node_id, len(hits), name))
        return 1
    g, node = hits[0]
    ns = g['props'].get('namespace')
    if not ns:
        print('  problem: the layer of node %s has no namespace, so OpenNMS does not load the view (./topo.sh view show %s)'
              % (node_id, name))
        return 1
    reset = icon_id == '--reset'
    defined = defined_ids(svg_folder)
    if not reset and defined and icon_id not in defined:
        near = similar(icon_id, icon_ids(svg_folder))
        print('  problem: no svg file in opennms/ defines the icon "%s": the node would have no icon.%s' % (
            icon_id, ' Similar ids: ' + ', '.join(near) + '.' if near else ''))
        print('  ./topo.sh icons lists the icon ids.')
        return 1
    cfg = Path(cfg)
    plain = '%s.%s' % (ns, node_id)
    label = (node.get('label') or '').replace('\n', ' ').strip()
    note = '# %s, node %s%s' % (name, node_id, ': ' + label if label else '')
    before = icon_of(ns, node, load_maps(cfg.parent))[0]
    lines = cfg.read_text(errors='replace').splitlines()
    mine = [i for i, raw in enumerate(lines) if (split_property(raw) or (None,))[0] == plain]
    if reset:
        if not mine:
            print('  Node %s of %s has no line in %s: nothing to take out.' % (node_id, name, cfg.name))
            return 0
        drop = set(mine) | {i - 1 for i in mine if i > 0 and lines[i - 1].strip() == note}
        lines = [raw for i, raw in enumerate(lines) if i not in drop]
    elif mine:
        lines[mine[0]] = '%s = %s' % (escaped(plain), icon_id)
        lines = [raw for i, raw in enumerate(lines) if i not in set(mine[1:])]
    else:
        lines += [note, '%s = %s' % (escaped(plain), icon_id)]
    cfg.write_text('\n'.join(lines) + '\n')
    after = icon_of(ns, node, load_maps(cfg.parent))[0]
    print('  Node %s (%s) of the view %s: the icon %s -> %s' % (node_id, label or 'no label', name, before, after))
    if not reset:
        print('  %s: %s = %s' % (cfg, escaped(plain), icon_id))
    for other in sorted(cfg.parent.glob('org.opennms.features.topology.app.icons.*.cfg')):
        if other.name != cfg.name and plain in java_properties(other):
            print('  ! %s has a line for this node too; OpenNMS may use that one' % other.name)
    for rest, sentence in stray_lines(graphs, load_maps(cfg.parent), other_namespaces(cfg.parent, name)):
        if rest == node_id and not reset:
            print('  ! ' + sentence)
    return 0


def prepare(source, target, svg_folder):
    ids = sorted(icon_ids(svg_folder))
    text = Path(source).read_text()
    told = set()

    def icon(m):
        word = m.group(1).lower()
        found = svgicons.pick(svg_folder, word, ids)
        if not found and word not in told:
            print('  no icon for @%s@ in the svg folder: left as it is' % m.group(1))
            told.add(word)
        return found or m.group(0)

    Path(target).write_text(re.sub(r'@([A-Za-z][A-Za-z0-9_-]*)@', icon, text))
    return 0


REQ = '{http://xmlns.opennms.org/xsd/config/model-import}'


def read_requisition(path):
    """(foreign source, [node]) of a requisition file: <model-import foreign-source="..."> with <node> elements."""
    root = ET.parse(path).getroot()
    if root.tag != REQ + 'model-import':
        raise ValueError('%s: not a requisition (<model-import> of %s)' % (path, REQ[1:-1]))
    nodes = []
    for n in root.findall(REQ + 'node'):
        nodes.append({'fid': n.get('foreign-id'), 'label': n.get('node-label') or n.get('foreign-id') or '',
                      'parent_fs': n.get('parent-foreign-source'), 'parent_fid': n.get('parent-foreign-id'),
                      'parent_label': n.get('parent-node-label'),
                      'categories': [c.get('name') for c in n.findall(REQ + 'category') if c.get('name')],
                      'assets': {a.get('name'): a.get('value') or '' for a in n.findall(REQ + 'asset')}})
    return root.get('foreign-source'), nodes


def read_types(path):
    """{type in lower case: icon id} of icon-types.cfg ("type = icon id" lines, # comments)."""
    table = {}
    for raw in Path(path).read_text(errors='replace').splitlines():
        line = raw.strip()
        if line and line[0] not in '#!' and '=' in line:
            kind, icon = line.split('=', 1)
            if kind.strip() and icon.strip():
                table[kind.strip().lower()] = icon.strip()
    return table


def type_of(node, table):
    """(type, where it comes from) of a requisition node, or (None, None)."""
    for c in node['categories']:
        if c.strip().lower() in table:
            return c.strip().lower(), 'category ' + c
    for field in ('category', 'modelNumber'):
        value = node['assets'].get(field, '').strip()
        if value.lower() in table:
            return value.lower(), 'asset ' + field
    word = re.match(r'[A-Za-z]+', node['label'])
    if word and word.group(0).lower() in table:
        return word.group(0).lower(), 'label'
    return None, None


def from_requisition(req_path, types_path, svg_folder, name, out):
    source, nodes = read_requisition(req_path)
    if not nodes:
        print('  problem: the requisition %s has no nodes' % source)
        return 1
    table, icons = read_types(types_path), sorted(icon_ids(svg_folder))
    by_fid = {n['fid']: n for n in nodes}
    by_label = {n['label']: n for n in nodes}

    def parent(n):  # a parent of the same requisition: by foreign id, or by node label
        if n['parent_fs'] and n['parent_fs'] != source:
            return None
        return by_fid.get(n['parent_fid']) if n['parent_fid'] else by_label.get(n['parent_label'])

    def level(n):
        depth, seen, p = 0, {n['fid']}, parent(n)
        while p and p['fid'] not in seen:
            depth, seen, p = depth + 1, seen | {p['fid']}, parent(p)
        return depth

    rows, xml_nodes, xml_edges, icon_note = [], [], [], {}
    for n in nodes:
        kind, where = type_of(n, table)
        icon = None
        if kind:
            wanted = table[kind]
            icon = wanted if wanted in icons else svgicons.pick(svg_folder, kind, icons)
            if icon != wanted:
                icon_note[kind] = ('no svg file has the icon %s; %s' % (wanted, 'it takes %s' % icon if icon else
                                                                         'its nodes get the default icon'))
        rows.append((n['label'], n['fid'], '%s (%s)' % (kind, where) if kind else '-', icon or '(default icon)'))
        data = [('label', n['label']), ('foreignSource', source), ('foreignID', n['fid']), ('level', str(level(n)))]
        if icon:
            data.insert(1, ('iconKey', icon))
        tip = ', '.join(n['categories'])
        if tip:
            data.append(('tooltipText', 'Categories: ' + tip))
        xml_nodes.append('    <node id=%s>%s</node>' % (quoteattr(n['fid']), ''.join(
            '<data key="%s">%s</data>' % (k, escape(v)) for k, v in data)))
        p = parent(n)
        if p:
            xml_edges.append('    <edge id=%s source=%s target=%s/>' % (
                quoteattr('%s-%s' % (p['fid'], n['fid'])), quoteattr(p['fid']), quoteattr(n['fid'])))
    label = '%s: icons by node type' % source
    keys = [('label', 'graphml', 'string'), ('label', 'graph', 'string'), ('namespace', 'graph', 'string'),
            ('focus-strategy', 'graph', 'string'), ('preferred-layout', 'graph', 'string'),
            ('vertex-status-provider', 'graph', 'string'), ('label', 'node', 'string'), ('iconKey', 'node', 'string'),
            ('foreignSource', 'node', 'string'), ('foreignID', 'node', 'string'), ('level', 'node', 'int'),
            ('tooltipText', 'node', 'string')]
    text = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<!-- Made by ./topo.sh view from-requisition from the requisition %s and icon-types.cfg (GUIDE-node-icons.md,'
            ' part 4). Each node: its OpenNMS node (foreignSource, foreignID), its parent above it, the icon of its type'
            ' as iconKey. -->' % escape(source).replace('--', '- -'),
            '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">']
    text += ['  <key id="%s" for="%s" attr.name="%s" attr.type="%s"/>' % (k, f, k, t) for k, f, t in keys]
    text += ['  <data key="label">%s</data>' % escape(label),
             '  <graph id=%s edgedefault="undirected">' % quoteattr(name),
             '    <data key="namespace">%s</data>' % escape(name),
             '    <data key="label">%s</data>' % escape(label),
             '    <data key="focus-strategy">ALL</data>',
             '    <data key="preferred-layout">Hierarchy Layout</data>',
             '    <data key="vertex-status-provider">default</data>']
    text += xml_nodes + xml_edges + ['  </graph>', '</graphml>', '']
    Path(out).write_text('\n'.join(text))
    print('  requisition %s: %d nodes, %d links to a parent' % (source, len(nodes), len(xml_edges)))
    print('  %-28s %-20s %-30s %s' % ('node label', 'foreign id', 'type (from)', 'icon (iconKey)'))
    for row in rows[:300]:
        print('  %-28s %-20s %-30s %s' % (row[0][:28], row[1][:20], row[2][:30], row[3]))
    if len(rows) > 300:
        print('  ... and %d more' % (len(rows) - 300))
    for kind, note in sorted(icon_note.items()):
        print('  ! type %s: %s' % (kind, note))
    if any(r[2] == '-' for r in rows):
        print('  Nodes without a type get the default icon: give them a category that icon-types.cfg names, or add a'
              ' line for their type.')
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
        if len(a) == 4 and a[0] == 'show':
            sys.exit(show(a[1], a[2], a[3]))
        if len(a) == 6 and a[0] == 'icon':
            sys.exit(set_icon(*a[1:]))
        if len(a) == 3 and a[0] == 'used':
            sys.exit(used(a[1], a[2]))
        if len(a) == 6 and a[0] == 'from-requisition':
            sys.exit(from_requisition(*a[1:]))
    except (ET.ParseError, ValueError, OSError) as e:
        print('  problem: %s' % e)
        sys.exit(1)
    sys.exit(__doc__)
