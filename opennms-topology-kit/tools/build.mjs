#!/usr/bin/env node
// Builds dist/ from src/ for the OpenNMS 33.1.8 topology page:
//   dist/svg/das-topology.<hash>.svg  src/style.css + one icon set per src/icons/<name>.svg
//   dist/icon-mapping.cfg             src/icon-mapping.cfg + src/icon-mapping.<target>.cfg
//   dist/manifest.env, manifest.json  what deploy.sh and the preview need
//
//   node tools/build.mjs [--target dev|prod]
//   node tools/build.mjs --watch [--port 8099]   rebuild on every save, live preview on the port,
//                                                and deploy into the dev OpenNMS when it is running
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimize } from 'svgo';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const PREFIX = 'das_'; // icon ids are das_<file name>; deploy.sh owns every mapping to such an id
const TILE = 100; // icon size in SVG units; OpenNMS scales the longest side of an icon to 48 px
const INSET = 12; // space between the tile edge and the artwork
const STATES = { normal: '', hover: '.hover', selected: '.selected' };

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const target = opt('--target', 'dev');
const rel = (file) => path.relative(ROOT, file);

// Cleans one icon file. Ids and class names get a per-icon prefix and <style> rules are inlined:
// OpenNMS loads all icon files into one page, where .cls-1 or id="a" from one file would
// otherwise change every other icon.
function artwork(file, text, prefix) {
  const root = text.match(/<svg\b[^>]*>/)?.[0];
  if (!root) throw new Error(`${rel(file)}: no <svg> element`);
  if (!/\bviewBox=/.test(root)) {
    const size = (name) => Number(root.match(new RegExp(`\\b${name}="([\\d.]+)(px)?"`))?.[1]);
    const [w, h] = [size('width'), size('height')];
    if (!w || !h) throw new Error(`${rel(file)}: <svg> needs a viewBox (or width and height in px)`);
    text = text.replace(root, root.replace(/^<svg\b/, `<svg viewBox="0 0 ${w} ${h}"`));
  }
  const { data } = optimize(text, {
    path: file,
    multipass: true,
    plugins: [
      { name: 'preset-default', params: { overrides: { inlineStyles: { onlyMatchedOnce: false } } } },
      'removeDimensions',
      { name: 'prefixIds', params: { prefix, delim: '-' } },
    ],
  });
  const open = data.match(/^<svg\b[^>]*>/)[0];
  return { viewBox: open.match(/\bviewBox="([^"]+)"/)[1], inner: data.slice(open.length, data.lastIndexOf('</svg>')) };
}

// The three groups OpenNMS expects for an icon id: <id> (normal), <id>_rollover (mouse over) and
// <id>_active (selected). It draws them on top of each other and fades the last two in.
function iconSet(id, art) {
  const box = `x="${INSET}" y="${INSET}" width="${TILE - 2 * INSET}" height="${TILE - 2 * INSET}"`;
  const state = (gid, tileClass, symbol) =>
    `<g id="${gid}"><rect class="das-tile${tileClass}" width="${TILE}" height="${TILE}" rx="14"/>` +
    `<use class="das-art" href="#${symbol}" xlink:href="#${symbol}" ${box}/></g>`;
  return (
    `<g id="${id}_icon">` +
    state(`${id}_active`, ' das-tile--selected', art.selected ?? art.normal) +
    state(`${id}_rollover`, ' das-tile--hover', art.hover ?? art.normal) +
    state(id, '', art.normal) +
    '</g>'
  );
}

// "<icon key> = <icon id>" lines. As in java.util.Properties, the key ends at the first
// unescaped '=', ':' or blank, so a colon in a key is written as "\:".
function mappingLines(file, text, ids) {
  return text.split(/\r?\n/).flatMap((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) return [];
    const m = line.match(/^((?:\\.|[^=:\s\\])+)(?:\s*[=:]\s*|\s+)(\S+)$/);
    const where = `${rel(file)}:${i + 1}`;
    if (!m) throw new Error(`${where}: expected "<icon key> = <icon id>"`);
    if (!ids.includes(m[2])) throw new Error(`${where}: unknown icon "${m[2]}" (have ${ids.join(', ')})`);
    return [[m[1], m[2]]];
  });
}

async function build() {
  const files = (await readdir(path.join(SRC, 'icons'))).filter((f) => f.endsWith('.svg')).sort();
  const names = files.filter((f) => !/\.(hover|selected)\.svg$/.test(f)).map((f) => f.slice(0, -4));
  if (!names.length) throw new Error('src/icons has no .svg files');

  const ids = [];
  const symbols = [];
  const sets = [];
  for (const name of names) {
    const id = PREFIX + name.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const art = {};
    for (const [state, suffix] of Object.entries(STATES)) {
      const file = path.join(SRC, 'icons', `${name}${suffix}.svg`);
      if (!existsSync(file)) continue;
      const symbol = `${id}_art${suffix.replace('.', '_')}`;
      const { viewBox, inner } = artwork(file, await readFile(file, 'utf8'), symbol);
      symbols.push(`<symbol id="${symbol}" viewBox="${viewBox}">${inner}</symbol>`);
      art[state] = symbol;
    }
    ids.push(id);
    sets.push(iconSet(id, art));
  }

  const css = (await readFile(path.join(SRC, 'style.css'), 'utf8')).replaceAll(']]>', ']]]]><![CDATA[>');
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="0" height="0">',
    '<!-- Generated by tools/build.mjs from src/. Do not edit. -->',
    `<style><![CDATA[\n${css}]]></style>`,
    `<defs>${symbols.join('\n')}</defs>`,
    ...sets,
    '</svg>',
    '',
  ].join('\n');
  optimize(svg, { plugins: [] }); // throws if the result is not well-formed XML
  const svgFile = `das-topology.${createHash('sha256').update(svg).digest('hex').slice(0, 10)}.svg`;

  const mapping = new Map();
  for (const file of [path.join(SRC, 'icon-mapping.cfg'), path.join(SRC, `icon-mapping.${target}.cfg`)]) {
    if (!existsSync(file)) continue;
    for (const [key, id] of mappingLines(file, await readFile(file, 'utf8'), ids)) mapping.set(key, id);
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(path.join(DIST, 'svg'), { recursive: true });
  await writeFile(path.join(DIST, 'svg', svgFile), svg);
  await writeFile(
    path.join(DIST, 'icon-mapping.cfg'),
    [`# DAS topology kit: icon mappings for ${target}`, ...[...mapping].map(([k, v]) => `${k} = ${v}`), ''].join('\n'),
  );
  await writeFile(
    path.join(DIST, 'manifest.env'),
    `TARGET=${target}\nSVG_FILE=${svgFile}\nICON_PREFIX=${PREFIX}\nICON_IDS='${ids.join(' ')}'\n`,
  );
  await writeFile(path.join(DIST, 'manifest.json'), JSON.stringify({ target, svg: svgFile, ids }, null, 2));
  return { svgFile, ids, mappings: mapping.size };
}

const summary = (r) => `${r.svgFile}: ${r.ids.join(', ')}; ${r.mappings} icon mapping(s) for ${target}`;

if (!args.includes('--watch')) {
  try {
    console.log(`built ${summary(await build())}`);
  } catch (e) {
    console.error(`build failed: ${e.message}`);
    process.exit(1);
  }
} else {
  const port = Number(opt('--port', 8099));
  const clients = new Set();
  const log = (msg) => console.log(`${new Date().toLocaleTimeString()} ${msg}`);
  const deploy = () =>
    new Promise((done) =>
      spawn(path.join(ROOT, 'deploy.sh'), ['dev', '--no-build', '--if-running'], { cwd: ROOT, stdio: 'inherit' })
        .on('exit', done)
        .on('error', done),
    );
  let busy = false;
  let again = false;
  const cycle = async () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      log(`built ${summary(await build())}`);
      for (const res of clients) res.write('data: reload\n\n');
      await deploy();
    } catch (e) {
      log(`build failed: ${e.message}`);
    }
    busy = false;
    if (again) {
      again = false;
      cycle();
    }
  };
  // Polls names, sizes and times of the files in src/ and overlay/. fs.watch misses changes to files
  // that an editor saved by replacing them (a rename), which many editors do.
  const snapshot = async (dir, out = []) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await snapshot(file, out);
      else {
        const s = await stat(file).catch(() => null);
        if (s) out.push(`${file} ${s.size} ${s.mtimeMs}`);
      }
    }
    return out;
  };
  const state = async () => [...(await snapshot(SRC)), ...(await snapshot(path.join(ROOT, 'overlay')))].sort().join('\n');
  let last = await state();
  const poll = async () => {
    const now = await state();
    if (now !== last) {
      last = now;
      await cycle();
    }
    setTimeout(poll, 300);
  };
  setTimeout(poll, 300);

  const types = { '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' };
  createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      clients.add(res);
      return req.on('close', () => clients.delete(res));
    }
    const inDist = url.pathname.startsWith('/dist/');
    if (url.pathname !== '/' && !inDist) return res.writeHead(404).end();
    const file = inDist
      ? path.join(DIST, path.normalize(decodeURIComponent(url.pathname.slice(5))))
      : path.join(ROOT, 'tools', 'preview.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'text/plain', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(port, () => log(`preview on http://localhost:${port} (watching src/ and overlay/)`));
  cycle();
}
