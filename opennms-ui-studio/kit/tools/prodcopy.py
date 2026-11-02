#!/usr/bin/env python3
"""Production's requisitions (its nodes) in the development OpenNMS: ./dev.sh copy-prod and ./dev.sh remove-nodes.
GUIDE-node-icons.md, part 2, says what happens in OpenNMS.

  prodcopy.py copy <dev url> <user> <password> <folder> [<requisition>...]
      <folder> holds production's etc/imports and etc/foreign-sources (the deployed requisitions and their
      foreign source definitions). Each requisition, all or the ones named, goes to the development OpenNMS through
      its REST API the way the web UI sends it: the foreign source definition (POST rest/foreignSources), the
      requisition (POST rest/requisitions), then an import (PUT rest/requisitions/<name>/import?rescanExisting=false).
      Then it waits until the nodes are in dev's database (provisiond inserts them, then scans them).
  prodcopy.py views <dev url> <user> <password> <graphml folder>
      how the nodes of each GraphML view link to OpenNMS nodes (foreignSource and foreignID, or nodeID) and whether
      dev has those nodes: a view shows the status of the node it links to.
  prodcopy.py remove <dev url> <user> <password> <requisition>
      the requisition and its nodes out of the development OpenNMS: an import of the requisition without nodes (that
      deletes them), then DELETE of the requisition and its foreign source definition, pending and deployed.
"""
import base64
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import quoteattr

REQ = '{http://xmlns.opennms.org/xsd/config/model-import}'
DEMO = 'DAS-Demo'  # the kit's own demo requisition: dev only
WAIT = 240         # seconds to wait for the nodes of one requisition


class Rest:
    def __init__(self, url, user, password):
        self.url = url.rstrip('/')
        self.auth = 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode()

    def call(self, method, path, body=None, accept='application/json'):
        data = body.encode() if isinstance(body, str) else body
        headers = {'Authorization': self.auth, 'Accept': accept}
        if data is not None:
            headers['Content-Type'] = 'application/xml'
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                text = res.read().decode('utf-8', 'replace')
                return json.loads(text) if 'json' in res.headers.get('Content-Type', '') and text else text
        except urllib.error.HTTPError as e:
            hint = ' (DEV_USER and DEV_PASSWORD in kit.env are not right)' if e.code == 401 else ''
            raise RuntimeError(f'{method} {path}: HTTP {e.code}{hint} {e.read().decode("utf-8", "replace")[:200]}') from None
        except OSError as e:
            raise RuntimeError(f'{method} {path}: {e}') from None

    def nodes(self, source=None):
        path = '/rest/nodes?limit=0' + ('&foreignSource=' + urllib.parse.quote(source) if source else '')
        found = self.call('GET', path) or {}
        found = found.get('node', []) if isinstance(found, dict) else []
        return found if isinstance(found, list) else [found]


def q(name):
    return urllib.parse.quote(name, safe='')


def requisitions(folder):
    """{foreign source: (requisition file, [foreign ids])} of the deployed requisitions in folder/imports."""
    out = {}
    for path in sorted(Path(folder, 'imports').glob('*.xml')):
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError as e:
            print(f'  ! {path.name}: not readable XML ({e}); left out')
            continue
        if root.tag != REQ + 'model-import' or not root.get('foreign-source'):
            continue
        out[root.get('foreign-source')] = (path, [n.get('foreign-id') for n in root.findall(REQ + 'node')])
    return out


def foreign_source(folder, name):
    """The foreign source definition of that name in folder/foreign-sources, or None (dev's default applies)."""
    for path in sorted(Path(folder, 'foreign-sources').glob('*.xml')):
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError:
            continue
        if root.tag.endswith('foreign-source') and root.get('name') == name:
            return path
    return None


def wait_for(rest, source, want, gone=False):
    """Wait until dev has want nodes of that requisition (gone: none). The count it reached."""
    start, said, have = time.time(), time.time(), -1
    while True:
        have = len(rest.nodes(source))
        if (have == 0) if gone else (have >= want):
            return have
        if time.time() - start > WAIT:
            return have
        if time.time() - said >= 20:
            said = time.time()
            print(f'    {int(time.time() - start)} s: {have} of {want} nodes' if not gone else f'    {have} nodes left')
        time.sleep(3)


def copy(rest, folder, names):
    found = requisitions(folder)
    if not found:
        print("  Production has no deployed requisitions (its etc/imports holds no requisition file).")
        return 1
    wanted = names or [n for n in found if n != DEMO]
    missing = [n for n in wanted if n not in found]
    if missing:
        print('  Production has no requisition %s. Its requisitions: %s' % (', '.join(missing), ', '.join(found)))
        return 1
    failed = []
    for name in wanted:
        path, fids = found[name]
        fs = foreign_source(folder, name)
        print(f'  {name}: {len(fids)} node(s)' + (', with its foreign source definition' if fs else
                                                  ' (no foreign source definition of its own: dev uses its default one)'))
        try:
            if fs:
                rest.call('POST', '/rest/foreignSources', fs.read_bytes(), accept='application/xml')
            rest.call('POST', '/rest/requisitions', path.read_bytes(), accept='application/xml')
            rest.call('PUT', f'/rest/requisitions/{q(name)}/import?rescanExisting=false', accept='application/xml')
        except RuntimeError as e:
            print(f'    failed: {e}')
            failed.append(name)
            continue
        have = wait_for(rest, name, len(fids))
        if have >= len(fids):
            print(f'    dev has its {have} node(s)')
        else:
            print(f'    dev has {have} of {len(fids)} node(s) after {WAIT} s; provisiond goes on in the background '
                  f'(./dev.sh status counts them, ./dev.sh logs provisiond.log shows the import)')
    if failed:
        print('  These requisitions did not go in: ' + ', '.join(failed))
        return 1
    return 0


def graphml_nodes(path):
    """(namespace, [node properties]) of each graph of a GraphML file (the parts that link it to OpenNMS nodes)."""
    ns = '{http://graphml.graphdrawing.org/xmlns}'
    root = ET.parse(path).getroot()
    keys = {k.get('id'): k.get('attr.name') or k.get('id') for k in root.iter(ns + 'key')}
    out = []
    for graph in root.findall(ns + 'graph'):
        props = {keys.get(d.get('key'), d.get('key')): (d.text or '').strip() for d in graph.findall(ns + 'data')}
        nodes = []
        for n in graph.findall(ns + 'node'):
            p = {keys.get(d.get('key'), d.get('key')): (d.text or '').strip() for d in n.findall(ns + 'data')}
            p['id'] = n.get('id')
            nodes.append(p)
        out.append((props.get('namespace', graph.get('id')), nodes))
    return out


def views(rest, folder):
    files = sorted(Path(folder).glob('*.xml'))
    if not files:
        print('  no GraphML views')
        return 0
    dev = rest.nodes()
    by_id = {str(n.get('id')): n for n in dev}
    by_ref = {(n.get('foreignSource'), n.get('foreignId')): n for n in dev}
    worry = False
    for path in files:
        try:
            graphs = graphml_nodes(path)
        except ET.ParseError as e:
            print(f'  {path.stem}: not readable ({e})')
            continue
        for namespace, nodes in graphs:
            by_fs, by_fs_missing, by_nid, by_nid_wrong, drawings = 0, [], 0, [], 0
            for n in nodes:
                if n.get('nodeID'):  # OpenNMS uses nodeID first (GraphMLTopologyProvider)
                    by_nid += 1
                    hit = by_id.get(n['nodeID'])
                    by_nid_wrong.append('%s: nodeID %s is %s on dev' % (
                        n.get('label') or n['id'], n['nodeID'], 'no node' if not hit else '"%s" (%s:%s)' % (
                            hit.get('label'), hit.get('foreignSource') or '-', hit.get('foreignId') or '-')))
                elif n.get('foreignSource') and n.get('foreignID'):
                    by_fs += 1
                    if (n['foreignSource'], n['foreignID']) not in by_ref:
                        by_fs_missing.append('%s (%s:%s)' % (n.get('label') or n['id'], n['foreignSource'], n['foreignID']))
                else:
                    drawings += 1
            parts = []
            if by_fs:
                parts.append('%d by foreignSource and foreignID%s' % (by_fs, ', all on dev' if not by_fs_missing else
                                                                       ', %d not on dev' % len(by_fs_missing)))
            if by_nid:
                parts.append('%d by nodeID, the database id of a node where the view was written' % by_nid)
            if drawings:
                parts.append('%d drawing(s) without a node' % drawings)
            print('  %s (namespace %s): %d nodes; linked %s' % (path.stem, namespace, len(nodes), '; '.join(parts) or '-'))
            for item in (by_fs_missing + by_nid_wrong)[:5]:
                print('    ! ' + item)
            if len(by_fs_missing + by_nid_wrong) > 5:
                print('    ! ... and %d more' % (len(by_fs_missing + by_nid_wrong) - 5))
            worry = worry or bool(by_fs_missing or by_nid_wrong)
    if worry:
        print('  nodeID is the database id of a node in the OpenNMS that wrote the view. Dev numbers its nodes itself,')
        print('  so on dev the same number is another node, or none, and the view shows that node\'s status: compare the')
        print('  lines above with production. foreignSource and foreignID name a node the same way in every OpenNMS.')
        print('  A node that is not on dev: copy its requisition (./dev.sh copy-prod <requisition>); a view looks up its')
        print('  nodes when it is loaded (./topo.sh view reload). GUIDE-node-icons.md, part 2.4.')
    return 0


def remove(rest, name):
    have = len(rest.nodes(name))
    print(f'  {name}: {have} node(s) on dev')
    try:
        rest.call('POST', '/rest/requisitions',
                  '<model-import xmlns="http://xmlns.opennms.org/xsd/config/model-import" foreign-source=%s/>'
                  % quoteattr(name), accept='application/xml')
        rest.call('PUT', f'/rest/requisitions/{q(name)}/import?rescanExisting=false', accept='application/xml')
    except RuntimeError as e:
        print(f'  failed: {e}')
        return 1
    left = wait_for(rest, name, 0, gone=True)
    print(f'  {have - left} node(s) deleted' + (f', {left} still there' if left else ''))
    for path in (f'/rest/requisitions/{q(name)}', f'/rest/requisitions/deployed/{q(name)}',
                 f'/rest/foreignSources/{q(name)}', f'/rest/foreignSources/deployed/{q(name)}'):
        try:
            rest.call('DELETE', path, accept='application/xml')
        except RuntimeError:
            pass  # not there: fine
    print('  the requisition and its foreign source definition are gone from dev')
    return 1 if left else 0


def main(argv):
    if len(argv) >= 5 and argv[0] == 'copy':
        return copy(Rest(*argv[1:4]), argv[4], argv[5:])
    if len(argv) == 5 and argv[0] == 'views':
        return views(Rest(*argv[1:4]), argv[4])
    if len(argv) == 5 and argv[0] == 'remove':
        return remove(Rest(*argv[1:4]), argv[4])
    sys.stderr.write(__doc__)
    return 2


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except RuntimeError as e:
        print(f'  failed: {e}')
        sys.exit(1)
