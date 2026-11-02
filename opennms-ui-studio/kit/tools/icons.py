#!/usr/bin/env python3
"""./topo.sh icons: the icons the svg files in opennms/ define, and the icon each node gets.

OpenNMS 33.1.8 picks a node's icon like this (IconRepositoryManager.getSVGIconId):
  1. "<namespace>.<vertex id>" in an icon mapping file: a mapping for this one node;
  2. the node's icon key in a mapping file, then the key without its last ".part", and so on;
     in a GraphML view the icon key is the icon id itself (the view answers for its own keys, unchanged);
  3. "default" in a mapping file.
The rules here use the mapping files in opennms/etc, so they show what a deploy would give. GUIDE-node-icons.md,
part 3, walks through them.
"""
import base64
import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import svgicons  # tools/svgicons.py: which ids of the svg files are icons, and what is wrong with a file

SVG = Path('opennms/jetty-webapps/opennms/svg')
ETC = Path('opennms/etc')
STOCK_NAMESPACES = ('nodes', 'pathoutage', 'application', 'bsm', 'vmware')  # views that are not GraphML views


def properties(path):
    """java.util.Properties, enough for icon mappings: # and ! comments, '=' ':' or blanks after the key, \\ escapes."""
    out = {}
    for raw in path.read_text(errors='replace').splitlines():
        line = raw.lstrip()
        if not line or line[0] in '#!':
            continue
        key, i = '', 0
        while i < len(line) and line[i] not in '=: \t\f':
            if line[i] == '\\' and i + 1 < len(line):
                i += 1
            key += line[i]
            i += 1
        value = line[i:].lstrip(' \t\f')
        if value[:1] in ('=', ':'):
            value = value[1:]
        out[key] = value.strip()
    return out


DEFINED = set()  # every id of every svg file: <use href="#id"> draws any of them (GWTVertex)


def main():
    if not SVG.is_dir():
        sys.exit('There is no opennms/ yet: ./topo.sh pull')
    files = svgicons.svg_files(SVG)
    for f in files:
        DEFINED.update(f.ids)
    print(f'Icons in {SVG}:')
    for f in files:
        shown = ', '.join(f.icons) if len(f.icons) <= 12 else f'{len(f.icons)} icons: ' + ', '.join(f.icons[:8]) + ', ...'
        print(f'  {f.name:<26} {shown or "(no icon: no id X with X_rollover, X_active or X_icon next to it)"}')
    for f in files:
        if not f.stock:  # OpenNMS's own files have quirks of their own
            for problem in f.problems():
                print(f'  ! {f.name}: {problem}')

    repos = {f.name: properties(f) for f in sorted(ETC.glob('org.opennms.features.topology.app.icons.*.cfg'))}

    def lookup(key):
        return next(((m[key], name) for name, m in repos.items() if key in m), None)

    def resolve(namespace, vertex_id, key):
        hit = lookup(f'{namespace}.{vertex_id}')
        if hit:
            return hit[0], f'{namespace}.{vertex_id} in {hit[1]}'
        graphml = namespace not in STOCK_NAMESPACES and not namespace.startswith('nodes:')
        if graphml and key:  # GraphMLIconRepository: every icon key of the view is an icon id of itself, unchanged
            other = lookup(key)
            note = f'; {other[1]} maps "{key}" too, and OpenNMS takes either, in no fixed order' if other and other[0] != key else ''
            return key, f'GraphML: the icon key is the icon id{note}'
        while key:
            hit = lookup(key)
            if hit:
                return hit[0], f'{key} in {hit[1]}'
            if key == 'default':
                return None, 'no "default" mapping'
            key = key.rsplit('.', 1)[0] if '.' in key else 'default'
        hit = lookup('default')
        return (hit[0], f'default in {hit[1]}') if hit else (None, 'no mapping')

    url, user, password = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
    if not user:
        user = input(f'OpenNMS user for {url}: ')
    if not password:
        password = getpass.getpass(f'Password of {user}: ')
    auth = 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode()

    def get(path):
        req = urllib.request.Request(url + path, headers={'Authorization': auth, 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as res:
            text = res.read().decode()
            return json.loads(text) if text else None

    print(f'\nNodes on {url} and the icon each gets with the mapping files in {ETC}:')
    try:
        containers = get('/api/v2/graphs') or []
    except urllib.error.HTTPError as e:
        sys.exit(f'  {url}/api/v2/graphs: HTTP {e.code}' + (' (wrong user or password)' if e.code == 401 else ''))
    except OSError as e:
        sys.exit(f'  {url} does not answer: {e}')
    for container in containers:
        for graph in container.get('graphs', []):
            try:
                data = get(f"/api/v2/graphs/{urllib.parse.quote(container['id'], safe='')}/"
                           f"{urllib.parse.quote(graph['namespace'], safe='')}") or {}
            except (urllib.error.HTTPError, OSError) as e:
                print(f"  {graph.get('label')}: {e}")
                continue
            vertices = data.get('vertices', [])
            print(f"  View \"{graph.get('label') or container.get('label')}\" (namespace {graph['namespace']}), {len(vertices)} node(s)")
            for v in vertices[:200]:
                icon, rule = resolve(v.get('namespace', graph['namespace']), v.get('id'), v.get('iconKey'))
                flag = '' if icon in DEFINED else '   ! no svg defines this icon: the node shows none'
                print(f"    {str(v.get('label'))[:22]:<22} key {str(v.get('iconKey'))[:44]:<44} -> {icon}  ({rule}){flag}")
            if len(vertices) > 200:
                print(f'    ... and {len(vertices) - 200} more')


main()
