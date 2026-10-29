#!/usr/bin/env python3
"""Demo DAS for the development OpenNMS (called by ./dev.sh up).

Six nodes without IP interfaces (nothing is polled) in requisition DAS-Demo, a SNMP sysObjectID per
type so Enhanced Linkd gives them icon keys like a real device, user-defined links between them, the
GraphML view "DAS demo" and one nodeDown alarm (a coloured status frame).
"""
import argparse
import base64
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Demo sysObjectIDs (enterprise 99999 is a placeholder): icon key linkd.system.snmp.1.3.6.1.4.1.99999.1.<n>
SYSOID = {'orion': '.1.3.6.1.4.1.99999.1.1', 'helix': '.1.3.6.1.4.1.99999.1.2',
          'stratus': '.1.3.6.1.4.1.99999.1.3', 'nimbus': '.1.3.6.1.4.1.99999.1.4'}
STOCK = {'orion': 'router', 'helix': 'switch', 'stratus': 'server', 'nimbus': 'wifiAccess'}
LINKS = [('orion-1', 'Q1', 'stratus-1', 'QSFP28 100G'), ('orion-1', 'Q2', 'helix-1', 'QSFP+ 40G'),
         ('orion-1', 'Q3', 'stratus-2', 'SFP28 25G in QSA'), ('helix-1', 'S1', 'nimbus-1', 'SFP28 25G'),
         ('helix-1', 'S2', 'nimbus-2', 'SFP28 25G')]

args = argparse.ArgumentParser()
for a in ('url', 'user', 'password', 'container', 'podman'):
    args.add_argument('--' + a, required=True)
opt = args.parse_args()
AUTH = 'Basic ' + base64.b64encode(f'{opt.user}:{opt.password}'.encode()).decode()


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


def icon_ids():
    """The icon ids the svg files of the development OpenNMS define (<g id="<id>_icon">)."""
    cmd = opt.podman.split() + ['exec', opt.container, 'sh', '-c', 'cat /opt/opennms/jetty-webapps/opennms/svg/*.svg']
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    return set(re.findall(r'id="([^"]+)_icon"', out))


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
        ids = icon_ids()
        graph = (ROOT / 'seed' / 'das-demo.graphml').read_text()
        for kind, stock in STOCK.items():
            own = next((i for i in sorted(ids) if i.lower() == kind), None) or \
                next((i for i in sorted(ids) if kind in i.lower()), None)
            graph = graph.replace(f'@{kind}@', own or stock)
            print(f'  {kind}: icon {own or stock}' + ('' if own else ' (stock; no ' + kind + ' icon in the svg folder)'))
        try:
            rest('DELETE', '/rest/graphml/das-demo')
        except RuntimeError:
            pass  # not there yet
        rest('POST', '/rest/graphml/das-demo', graph)

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


try:
    main()
except Exception as e:
    print(f'seed failed: {e}', file=sys.stderr)
    sys.exit(1)
