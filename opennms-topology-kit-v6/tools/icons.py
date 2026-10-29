#!/usr/bin/env python3
"""./topo.sh icons: the icons the svg files in opennms/ define, and the icon each node gets.

OpenNMS 33.1.8 picks a node's icon like this (IconRepositoryManager.getSVGIconId):
  1. "<namespace>.<vertex id>" in an icon mapping file: a mapping for this one node;
  2. the node's icon key in a mapping file, then the key without its last ".part", and so on;
     in a GraphML view the icon key is the icon id itself;
  3. "default" in a mapping file.
The rules here use the mapping files in opennms/etc, so they show what a deploy would give.
"""
import base64
import getpass
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SVG = Path('opennms/jetty-webapps/opennms/svg')
ETC = Path('opennms/etc')
STOCK = {'opennms_icons.svg', 'atlas_icons.svg', 'vmware_icons.svg', 'legacy_icons.svg'}  # not checked: they have quirks


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


def svg_icons():
    """{icon id: (file, missing state groups)} for every <g id="<id>_icon"> in the svg folder."""
    found = {}
    for f in sorted(SVG.glob('*.svg')):
        ids = set(re.findall(r'\bid="([^"]+)"', f.read_text(errors='replace')))
        for icon in sorted(i[:-5] for i in ids if i.endswith('_icon')):
            found[icon] = (f.name, [s for s in (icon, icon + '_rollover', icon + '_active') if s not in ids])
    return found


def main():
    if not SVG.is_dir():
        sys.exit('There is no opennms/ yet: ./topo.sh pull')
    icons = svg_icons()
    print(f'Icons in {SVG}:')
    by_file = {}
    for icon, (name, _) in icons.items():
        by_file.setdefault(name, []).append(icon)
    for name, ids in sorted(by_file.items()):
        shown = ', '.join(ids) if len(ids) <= 12 else f'{len(ids)} icons: ' + ', '.join(ids[:8]) + ', ...'
        print(f'  {name:<26} {shown}')
    for icon, (name, missing) in icons.items():
        if missing and name not in STOCK:
            print(f'  ! {name}: icon "{icon}" lacks the group(s) {", ".join(missing)}; '
                  'OpenNMS draws <id> normally, <id>_rollover under the mouse and <id>_active when selected')
    for f in sorted(SVG.glob('*.svg')):
        if f.name not in by_file and not f.name.startswith('zz-'):
            print(f'  ! {f.name} has no <g id="..._icon"> group, so it adds no icon')

    repos = {f.name: properties(f) for f in sorted(ETC.glob('org.opennms.features.topology.app.icons.*.cfg'))}

    def lookup(key):
        return next(((m[key], name) for name, m in repos.items() if key in m), None)

    def resolve(namespace, vertex_id, key):
        hit = lookup(f'{namespace}.{vertex_id}')
        if hit:
            return hit[0], f'{namespace}.{vertex_id} in {hit[1]}'
        while key:
            hit = lookup(key)
            if hit:
                return hit[0], f'{key} in {hit[1]}'
            if key == 'default':
                return None, 'no "default" mapping'
            if '.' not in key and key in icons:
                return key, 'GraphML: the icon key is the icon id'
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
                flag = '' if icon in icons else '   ! no svg defines this icon: the node shows none'
                print(f"    {str(v.get('label'))[:22]:<22} key {str(v.get('iconKey'))[:44]:<44} -> {icon}  ({rule}){flag}")
            if len(vertices) > 200:
                print(f'    ... and {len(vertices) - 200} more')


main()
