#!/usr/bin/env node
// OpenNMS REST helpers.
//
//   node tools/onms.mjs map [--url URL] [--user U] [--password P] [--foreign-source NAME]
//                           [--views nodes,nodes:UserDefined] [--out FILE]
//     Prints icon-mapping lines for your nodes. A node's type is the first icon name from src/icons
//     (orion, helix, ...) found in its label, sysName, sysDescription, foreign ID, categories or asset
//     fields. Types whose nodes all share a sysObjectID that no other node has get one
//     linkd.system.snmp.<sysObjectID> line (every Enhanced Linkd view, future nodes too); the
//     others get one line per node and view (namespace "nodes" is the "All" view).
//
//   node tools/onms.mjs seed [--url URL] [--user U] [--password P]
//     Development only: demo DAS nodes, user-defined links, a GraphML view, one alarm, and
//     src/icon-mapping.dev.cfg for the demo nodes.
//
// The password can also come from ONMS_PASSWORD (and URL/user from ONMS_URL/ONMS_USER).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = opt('--url', process.env.ONMS_URL ?? 'http://localhost:8980/opennms').replace(/\/+$/, '');
const auth = Buffer.from(`${opt('--user', process.env.ONMS_USER ?? 'admin')}:${opt('--password', process.env.ONMS_PASSWORD ?? 'admin')}`).toString('base64');
const iconId = (name) => 'das_' + name.toLowerCase().replace(/[^a-z0-9_]+/g, '_'); // as in build.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, route, body, accept = 'application/json') {
  const res = await fetch(base + route, {
    method,
    headers: { Authorization: `Basic ${auth}`, Accept: accept, ...(body && { 'Content-Type': 'application/xml' }) },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return res.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : text;
}

async function nodes(foreignSource) {
  const filter = foreignSource ? `&foreignSource=${encodeURIComponent(foreignSource)}` : '';
  const list = (await rest('GET', `/rest/nodes?limit=0${filter}`))?.node ?? [];
  return Array.isArray(list) ? list : [list];
}

async function iconNames() {
  const files = await readdir(path.join(ROOT, 'src', 'icons'));
  return files
    .filter((f) => f.endsWith('.svg') && !/\.(hover|selected)\.svg$/.test(f))
    .map((f) => f.slice(0, -4))
    .sort((a, b) => b.length - a.length); // "nimbus-xl" before "nimbus"
}

function typeOf(node, names) {
  const a = node.assetRecord ?? {};
  const text = [node.label, node.sysName, node.sysDescription, node.foreignId, ...(node.categories ?? []).map((c) => c.name),
    a.category, a.displayCategory, a.modelNumber, a.description].filter(Boolean).join(' ').toLowerCase();
  return names.find((name) => text.includes(name.toLowerCase()));
}

function mapping(all, names, views, source) {
  const oid = (n) => n.sysObjectId?.replace(/^\./, '') || undefined;
  const typed = all.map((n) => ({ n, type: typeOf(n, names) }));
  const byOid = [];
  const perNode = [];
  for (const name of names) {
    const mine = typed.filter((t) => t.type === name);
    const oids = new Set(mine.map((t) => oid(t.n)));
    const unique = mine.length && !oids.has(undefined) && !typed.some((t) => t.type !== name && oids.has(oid(t.n)));
    if (unique) for (const o of oids) byOid.push(`linkd.system.snmp.${o} = ${iconId(name)}`);
    else for (const { n } of mine) for (const v of views) perNode.push(`${v.replaceAll(':', '\\:')}.${n.id} = ${iconId(name)}`);
  }
  const report = typed.map(({ n, type }) => `  ${String(n.id).padStart(5)}  ${(n.label ?? '').padEnd(28)} ${(type ?? '-').padEnd(10)} ${oid(n) ?? '(no sysObjectID)'}`);
  const text = [
    `# Generated from ${source} on ${new Date().toISOString().slice(0, 10)} by tools/onms.mjs map`,
    ...(byOid.length ? ['# By SNMP sysObjectID (all Enhanced Linkd views, future nodes of the same model too)', ...byOid] : []),
    ...(perNode.length ? [`# By node ID, for the views: ${views.join(', ')}`, ...perNode] : []),
    '',
  ].join('\n');
  return { text, report };
}

async function map() {
  const all = await nodes(opt('--foreign-source'));
  const { text, report } = mapping(all, await iconNames(), opt('--views', 'nodes').split(','), base);
  console.error(`  node id  label                        type       sysObjectID\n${report.join('\n')}\n`);
  const out = opt('--out');
  if (out) {
    await writeFile(out, text);
    console.error(`written to ${out}`);
  } else process.stdout.write(text);
}

// orion-1 Q1..Q3 to stratus-1, helix-1, stratus-2; helix-1 S1/S2 to nimbus-1/2
const DEMO_LINKS = [
  ['orion-1', 'Q1', 'stratus-1', 'Uplink', 'QSFP28 100G'],
  ['orion-1', 'Q2', 'helix-1', 'Uplink', 'QSFP+ 40G'],
  ['orion-1', 'Q3', 'stratus-2', 'Uplink', 'SFP28 25G in QSA'],
  ['helix-1', 'S1', 'nimbus-1', 'Uplink', 'SFP28 25G'],
  ['helix-1', 'S2', 'nimbus-2', 'Uplink', 'SFP28 25G'],
];

async function seed() {
  const fs = 'DAS-Demo';
  console.log('seed: requisition DAS-Demo (6 nodes)');
  await rest('POST', '/rest/requisitions', await readFile(path.join(ROOT, 'seed', 'das-demo.xml'), 'utf8'));
  await rest('PUT', `/rest/requisitions/${fs}/import?rescanExisting=false`);
  let list = [];
  for (let i = 0; i < 60 && list.length < 6; i++) {
    await sleep(3000);
    list = await nodes(fs);
  }
  if (list.length < 6) throw new Error(`only ${list.length} of 6 demo nodes were provisioned`);
  const id = Object.fromEntries(list.map((n) => [n.foreignId, n.id]));

  // The remaining steps are independent: one failing does not stop the others.
  const failed = [];
  const step = async (title, work) => {
    console.log(`seed: ${title}`);
    try {
      await work();
    } catch (e) {
      console.error(`  failed: ${e.message}`);
      failed.push(title);
    }
  };

  await step('user-defined links (Enhanced Linkd views "All" and "UserDefined")', async () => {
    const existing = await rest('GET', '/api/v2/userdefinedlinks?limit=0', undefined, 'application/xml');
    for (const [a, portA, z, portZ, label] of DEMO_LINKS) {
      if (existing.includes(`<link-id>${a}:${portA}-${z}:${portZ}</link-id>`)) continue;
      await rest('POST', '/api/v2/userdefinedlinks',
        `<user-defined-link><node-id-a>${id[a]}</node-id-a><component-label-a>${portA}</component-label-a>` +
        `<node-id-z>${id[z]}</node-id-z><component-label-z>${portZ}</component-label-z>` +
        `<link-id>${a}:${portA}-${z}:${portZ}</link-id><link-label>${label}</link-label><owner>das-demo</owner></user-defined-link>`);
    }
  });

  await step('GraphML view "DAS demo (GraphML)"', async () => {
    await rest('DELETE', '/rest/graphml/das-demo').catch(() => {});
    await rest('POST', '/rest/graphml/das-demo', await readFile(path.join(ROOT, 'seed', 'das-demo.graphml'), 'utf8'));
  });

  await step('a nodeDown alarm on nimbus-2', () =>
    rest('POST', '/rest/events',
      `<event xmlns="http://xmlns.opennms.org/xsd/event"><uei>uei.opennms.org/nodes/nodeDown</uei>` +
      `<source>das-topology-kit</source><nodeid>${id['nimbus-2']}</nodeid></event>`));

  await step('icon mappings for the demo nodes in src/icon-mapping.dev.cfg', async () => {
    const { text } = mapping(list, await iconNames(), ['nodes', 'nodes:UserDefined'], `${base} (${fs})`);
    await writeFile(path.join(ROOT, 'src', 'icon-mapping.dev.cfg'), text);
  });
  if (failed.length) throw new Error(`these steps failed: ${failed.join('; ')}`);
}

const commands = { map, seed };
if (!commands[args[0]]) {
  console.error('usage: node tools/onms.mjs map|seed [--url URL] [--user U] [--password P] ...');
  process.exit(2);
}
try {
  await commands[args[0]]();
} catch (e) {
  console.error(`${args[0]} failed: ${e.message}`);
  process.exit(1);
}
