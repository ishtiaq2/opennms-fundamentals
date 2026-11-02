#!/usr/bin/env python3
"""Demo DAS for the development OpenNMS (called by ./dev.sh up; README, "The demo").

Six nodes without IP interfaces (nothing is polled) in requisition DAS-Demo, each with a parent node (the Path
Outage view draws them as a tree), a SNMP sysObjectID per type so Enhanced Linkd gives them icon keys like a real
device, user-defined links between them, the GraphML view "DAS demo" and one nodeDown alarm (a coloured status frame).
"""
import argparse
import base64
import io
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import svgicons  # tools/svgicons.py: the icons of the svg files, the way the topology page draws them

ROOT = Path(__file__).resolve().parent.parent
# Demo sysObjectIDs (enterprise 99999 is a placeholder): icon key linkd.system.snmp.1.3.6.1.4.1.99999.1.<n>
SYSOID = {'orion': '.1.3.6.1.4.1.99999.1.1', 'helix': '.1.3.6.1.4.1.99999.1.2',
          'stratus': '.1.3.6.1.4.1.99999.1.3', 'nimbus': '.1.3.6.1.4.1.99999.1.4'}
# The icon of each node type when the svg folder has none of its own (the stock icons of opennms_icons.svg).
STOCK = {'orion': 'router', 'helix': 'switch', 'stratus': 'server', 'nimbus': 'wifiAccess'}
LINKS = [('orion-1', 'Q1', 'stratus-1', 'QSFP28 100G'), ('orion-1', 'Q2', 'helix-1', 'QSFP+ 40G'),
         ('orion-1', 'Q3', 'stratus-2', 'SFP28 25G in QSA'), ('helix-1', 'S1', 'nimbus-1', 'SFP28 25G'),
         ('helix-1', 'S2', 'nimbus-2', 'SFP28 25G')]

opt = None   # the command line (below)
AUTH = ''


def rest(method, path, body=None, ctype='application/xml', accept='application/json'):
    data = body.encode() if isinstance(body, str) else body
    req = urllib.request.Request(opt.url + path, data=data, method=method,
                                 headers={'Authorization': AUTH, 'Accept': accept, **({'Content-Type': ctype} if data else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            text = res.read().decode()
            return json.loads(text) if 'json' in res.headers.get('Content-Type', '') and text else text
    except urllib.error.HTTPError as e:
        hint = ' (wrong DEV_USER/DEV_PASSWORD in kit.env?)' if e.code == 401 else ''
        raise RuntimeError(f'{method} {path}: HTTP {e.code}{hint} {e.read().decode()[:200]}') from None


def nodes():
    found = rest('GET', '/rest/nodes?limit=0&foreignSource=DAS-Demo') or {}
    found = found.get('node', []) if isinstance(found, dict) else []
    return found if isinstance(found, list) else [found]


def svg_folder():
    """A temporary copy of the svg files of the development OpenNMS (None if podman cannot copy them)."""
    pm = opt.podman.split()
    home = subprocess.run(pm + ['exec', opt.container, 'readlink', '-f', '/opt/opennms'],
                          capture_output=True, text=True).stdout.strip() or '/opt/opennms'
    data = subprocess.run(pm + ['cp', f'{opt.container}:{home}/jetty-webapps/opennms/svg', '-'], capture_output=True).stdout
    folder = Path(tempfile.mkdtemp(prefix='kit-seed-svg-'))
    try:
        with tarfile.open(fileobj=io.BytesIO(data)) as tar:
            for member in tar.getmembers():  # only the files, by their own name: nothing lands outside the folder
                if member.isfile() and member.name.endswith('.svg'):
                    (folder / Path(member.name).name).write_bytes(tar.extractfile(member).read())
    except tarfile.TarError:
        shutil.rmtree(folder, ignore_errors=True)
        return None
    return folder


def icon_types():
    """{node type: icon id} from icon-types.cfg of the kit (GUIDE-node-icons.md, part 4), keys in lower case."""
    table, path = {}, ROOT / 'icon-types.cfg'
    if path.is_file():
        for raw in path.read_text(errors='replace').splitlines():
            line = raw.strip()
            if line and line[0] not in '#!' and '=' in line:
                key, value = line.split('=', 1)
                table[key.strip().lower()] = value.strip()
    return table


def icons_by_type(folder):
    """{node type: (icon id, note)} for the four demo types: the icon of icon-types.cfg if an svg file has it, else
    the icon named like the type (nimbus, das_nimbus, ...), else the stock icon."""
    files = svgicons.svg_files(folder) if folder else []
    icons = sorted({i for f in files for i in f.icons})
    table, out = icon_types(), {}
    for kind, stock in STOCK.items():
        wanted = table.get(kind)
        own = wanted if wanted in icons else (svgicons.pick(folder, kind, icons) if icons else None)
        named = 'the icon %s of icon-types.cfg' % wanted if wanted else 'an icon named like %s' % kind
        if not own:
            out[kind] = (stock, ', a stock icon (no svg file has %s, nor one named like %s)' % (named, kind)
                         if wanted else ', a stock icon (no svg file has %s)' % named)
            continue
        note = '' if own == wanted or not wanted else ' (no svg file has %s; %s is named like %s)' % (named, own, kind)
        home = next(f for f in files if own in f.icons)
        stacked = home.stacked(own)
        if stacked:  # the user's nimbus.svg: the three looks inside #nimbus, so the nodes show the last one
            note += (' (%s keeps its looks inside #%s, so a node shows #%s, the last one, until the file is repaired:'
                     ' GUIDE-node-icons.md, part 1.1)' % (home.name, own, stacked[-1]))
        out[kind] = (own, note)
    return out


def step(title, work, failed):
    print(f'seed: {title}')
    try:
        work()
    except Exception as e:  # each step is independent; report and go on
        print(f'  failed: {e}', file=sys.stderr)
        failed.append(title)


def main():
    print('seed: requisition DAS-Demo (6 nodes)')
    rest('POST', '/rest/requisitions', (ROOT / 'seed' / 'das-demo.xml').read_text())
    rest('PUT', '/rest/requisitions/DAS-Demo/import?rescanExisting=false')
    found = []
    for _ in range(60):
        found = nodes()
        if len(found) >= 6:
            break
        time.sleep(3)
    if len(found) < 6:
        raise RuntimeError(f'only {len(found)} of 6 demo nodes were created')
    node_id = {n['foreignId']: n['id'] for n in found}
    failed = []

    def sysoids():
        for fid, nid in node_id.items():
            form = urllib.parse.urlencode({'sysObjectId': SYSOID[fid.split('-')[0]]})
            rest('PUT', f'/rest/nodes/{nid}', form, 'application/x-www-form-urlencoded')

    def links():
        existing = rest('GET', '/api/v2/userdefinedlinks?limit=0', accept='application/xml') or ''
        for a, port, z, label in LINKS:
            link_id = f'{a}:{port}-{z}:Uplink'
            if f'<link-id>{link_id}</link-id>' in existing:
                continue
            rest('POST', '/api/v2/userdefinedlinks',
                 f'<user-defined-link><node-id-a>{node_id[a]}</node-id-a><component-label-a>{port}</component-label-a>'
                 f'<node-id-z>{node_id[z]}</node-id-z><component-label-z>Uplink</component-label-z>'
                 f'<link-id>{link_id}</link-id><link-label>{label}</link-label><owner>das-demo</owner></user-defined-link>')

    def graphml():
        folder = svg_folder()
        try:
            chosen = icons_by_type(folder)
        finally:
            if folder:
                shutil.rmtree(folder, ignore_errors=True)
        graph = (ROOT / 'seed' / 'das-demo.graphml').read_text()
        for kind, (icon, note) in chosen.items():  # the iconKey of a GraphML node is the icon id itself
            graph = graph.replace(f'@{kind}@', icon)
            print(f'  {kind} nodes: iconKey {icon}{note}')
        # The GraphML REST calls answer in XML only (@Produces application/xml): Accept JSON gets "406 Not Acceptable".
        try:
            rest('DELETE', '/rest/graphml/das-demo', accept='application/xml')
            time.sleep(5)  # Karaf must see the view's cfg file gone before it comes back, or it keeps the old view
        except RuntimeError:
            pass  # not there yet
        rest('POST', '/rest/graphml/das-demo', graph, accept='application/xml')

    def alarm():
        rest('POST', '/rest/events', '<event xmlns="http://xmlns.opennms.org/xsd/event">'
             '<uei>uei.opennms.org/nodes/nodeDown</uei><source>das-topology-kit</source>'
             f'<nodeid>{node_id["nimbus-2"]}</nodeid></event>')

    step('SNMP sysObjectIDs (Enhanced Linkd icon keys linkd.system.snmp.1.3.6.1.4.1.99999.1.<n>)', sysoids, failed)
    step('user-defined links (Enhanced Linkd)', links, failed)
    step('GraphML view "DAS demo"', graphml, failed)
    step('a nodeDown alarm on nimbus-2', alarm, failed)
    if failed:
        raise RuntimeError('these steps failed: ' + '; '.join(failed))


if __name__ == '__main__':
    args = argparse.ArgumentParser()
    for a in ('url', 'user', 'password', 'container', 'podman'):
        args.add_argument('--' + a, required=True)
    opt = args.parse_args()
    AUTH = 'Basic ' + base64.b64encode(f'{opt.user}:{opt.password}'.encode()).decode()
    try:
        main()
    except Exception as e:
        print(f'seed failed: {e}', file=sys.stderr)
        sys.exit(1)
