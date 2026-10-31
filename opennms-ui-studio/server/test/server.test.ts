// Unit tests of the parts of the studio that read and change OpenNMS files. Run: npm test
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { parseEnvFile } from '../src/config.js'
import { buildStyleSvg, hasRules, markId, markOn, mergeMappings, escapeKey } from '../src/modules/topology.js'
import { findBundleLabels, findNavbarLabel, readMenuNames, setBundleLabel, setMenuNames, setNavbarLabel, validLabel } from '../src/modules/menu.js'
import { readTar, readZipEntry } from '../src/util/archive.js'
import { namesIn, OVERLAY_FOLDERS } from '../src/overlay.js'
import { shellQuote } from '../src/run.js'

const root = resolve(import.meta.dirname, '..', '..')
const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name))
const tmp = mkdtempSync(join(tmpdir(), 'studio-test-'))
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))

test('kit.env settings are read, defaults of ${NAME:-value} included', () => {
  const env = parseEnvFile(readFileSync(join(root, 'kit', 'kit.env'), 'utf8'))
  assert.equal(env.PROD_SSH, 'maven-admin@192.168.0.36')
  assert.equal(env.PROD_CONTAINER, 'opennms')
  assert.equal(env.PROD_URL, 'http://192.168.0.36:8980/opennms')
  assert.equal(env.DEV_CONTAINER, 'onms-dev-core')
  assert.equal(env.DEV_PORT, '8980')
  assert.equal(env.STYLE_CSS, '../workspace/topology/topology.css')
  assert.equal(env.PODMAN, 'podman')
})

// The style file must be byte for byte what kit/topo.sh makes, or the kit's "css prod" would call it older.
function kitStyleSvg(cssPath: string): Buffer {
  const functions = execFileSync('sed', ['-n', '/^mark_on()/p;/^mark_id()/p;/^style_svg() {/,/^}/p', join(root, 'kit', 'topo.sh')]).toString()
  return execFileSync('bash', ['-c', `${functions}\nSTYLE_CSS="$1"; STYLE_NAME=styles/topology.css; style_svg`, 'bash', cssPath])
}

test('the style file is byte for byte what the topology kit makes', () => {
  const cases: Record<string, string> = {
    template: readFileSync(join(root, 'kit', 'tools', 'topology.css.template'), 'utf8'),
    rules: 'svg .vertex > rect.status.normal { fill: #F1F3F5; stroke: #8A97A8; }\n/* a ]]> in a comment */\n',
    'no newline at the end': 'svg path.edge { stroke: #1F3A5F; }',
    mark: 'svg .vertex-label { font-weight: bold; }\n  /* mark */  \n',
    empty: '',
    'non-ascii': '/* Grüße */ svg .vertex-label { fill: #123456; }\n',
  }
  for (const [name, css] of Object.entries(cases)) {
    const file = join(tmp, `${name.replace(/\W+/g, '-')}.css`)
    writeFileSync(file, css)
    assert.deepEqual(buildStyleSvg(readFileSync(file)), kitStyleSvg(file), name)
  }
  assert.equal(markOn('a {}\n/* mark */\n'), true)
  assert.equal(markOn('a {} /* mark */\n'), false)
  assert.equal(markId(Buffer.from('x')), '9dd4e4')
  assert.equal(hasRules('/* only a comment */\n'), false)
  assert.equal(hasRules('/* c */ svg a { b: c }'), true)
})

for (const file of ['menubar-vue3.3-min.js', 'menubar-vue3.3.js', 'menubar-vue3.5-min.js', 'menubar-vue3.5.js']) {
  test(`the Plugins label is found and changed in Menubar.vue compiled as ${file}`, () => {
    const js = fixture(file).toString('utf8')
    const found = findBundleLabels(js)
    assert.equal(found.length, 1)
    assert.equal(found[0].text, 'Plugins')
    const tools = setBundleLabel(js, 'Tools')
    assert.deepEqual(findBundleLabels(tools).map((f) => f.text), ['Tools'])
    assert.ok(tools.includes('" Tools "'), 'the spaces around the label stay')
    assert.equal(tools.length, js.length - 'Plugins'.length + 'Tools'.length, 'nothing else changes')
    assert.equal(tools.replace('" Tools "', '" Plugins "'), js)
    // Back from "Tools" to another text: the label is found by its place, not by its old text.
    const again = setBundleLabel(tools, 'Werkzeuge & Co')
    assert.deepEqual(findBundleLabels(again).map((f) => f.text), ['Werkzeuge & Co'])
    const out = join(tmp, file.replace('.js', '.mjs'))
    writeFileSync(out, again)
    execFileSync(process.execPath, ['--check', out]) // still valid JavaScript
  })
}

test('bundles without the menu bar, or with two, are not touched', () => {
  assert.deepEqual(findBundleLabels('const a = "menu";'), [])
  const js = fixture('menubar-vue3.3-min.js').toString('utf8')
  assert.equal(findBundleLabels(js + js).length, 2)
  assert.throws(() => setBundleLabel(js + js, 'Tools'))
})

test('navbar.ftl: the Plugins label of the JSP menu bar', () => {
  const ftl = fixture('navbar.ftl').toString('utf8')
  const f = findNavbarLabel(ftl)
  assert.ok(f)
  assert.equal(f.text, 'Plugins')
  assert.equal(f.line, 94)
  const changed = setNavbarLabel(ftl, 'Tools & More')
  assert.ok(changed.includes('aria-expanded="false">Tools &amp; More</a>'))
  assert.equal(findNavbarLabel(changed)?.text, 'Tools & More')
  assert.equal(findNavbarLabel(ftl, 'nav-help-top')?.text, 'Help')
  assert.equal(changed.split('\n').length, ftl.split('\n').length)
})

test('dispatcher-servlet.xml: the menu names in menu order, without the commented-out entry', () => {
  const xml = fixture('dispatcher-servlet.xml').toString('utf8')
  const names = readMenuNames(xml)
  assert.deepEqual(names.filter((n) => n.top).map((n) => n.name), ['Search', 'Info', 'Status', 'Reports', 'Dashboards', 'Maps'])
  assert.deepEqual(names.filter((n) => n.parent === 'Maps').map((n) => n.name), ['Topology', 'Geographical'])
  assert.deepEqual(names.filter((n) => n.parent === 'Dashboards').map((n) => n.name), ['Dashboard', 'Ops Board'])
  assert.ok(!names.some((n) => n.name === 'Admin'), 'the commented-out Admin entry does not count')
  assert.equal(new Set(names.map((n) => n.id)).size, names.length, 'ids are unique')
  const info = names.find((n) => n.name === 'Info')!
  const status = names.find((n) => n.name === 'Status')!
  assert.equal(info.id, '##1')
  assert.equal(status.id, '##2')
  const maps = names.find((n) => n.name === 'Maps')!
  const topo = names.find((n) => n.name === 'Topology')!
  const changed = setMenuNames(xml, { [maps.id]: 'Network Maps', [topo.id]: 'Topology & Links' })
  const after = readMenuNames(changed)
  assert.equal(after.find((n) => n.id === maps.id)?.name, 'Network Maps')
  assert.equal(after.find((n) => n.id === topo.id)?.name, 'Topology & Links')
  assert.ok(changed.includes('value="Topology &amp; Links"'))
  assert.equal(after.filter((n) => ![maps.id, topo.id].includes(n.id)).map((n) => n.name).join('|'),
    names.filter((n) => ![maps.id, topo.id].includes(n.id)).map((n) => n.name).join('|'))
  const out = join(tmp, 'dispatcher.xml')
  writeFileSync(out, changed)
  execFileSync('python3', ['-c', 'import sys, xml.dom.minidom; xml.dom.minidom.parse(sys.argv[1])', out]) // still well-formed XML
  // Search keeps its name: Menubar.vue finds that menu by the name "Search"
  const search = names.find((n) => n.name === 'Search')!
  assert.ok(search.top && search.locked, 'Search is locked')
  assert.ok(names.filter((n) => n !== search).every((n) => n.locked === null), 'only Search is locked')
  assert.equal(setMenuNames(xml, { [search.id]: 'Find' }), xml, 'a locked name is not changed')
})

test('labels: words only, no markup or template syntax', () => {
  for (const ok of ['Tools', 'Mes outils', 'Tools & More', 'Werkzeuge', "Operator's tools", 'Tools (beta)']) assert.ok(validLabel(ok), ok)
  for (const bad of ['', ' Tools', 'Tools ', '<b>x</b>', '${x}', 'a"b', 'a\\b', 'x'.repeat(41), '#{x}']) assert.ok(!validLabel(bad), bad)
})

test('icon mappings: the studio block is added, replaced and removed, other lines stay', () => {
  const stock = '# stock mappings\ndefault = generic\nMaven-abc.10 = das_helix\n'
  const one = mergeMappings(stock, { 'Maven-abc.11': 'das_nimbus' })
  assert.ok(one.startsWith(stock))
  assert.ok(one.includes('\nMaven-abc.11 = das_nimbus\n'))
  const two = mergeMappings(one, { 'Maven-abc.11': 'orion', 'maven:abc.12': 'cirrus' })
  assert.ok(two.includes('maven\\:abc.12 = cirrus'))
  assert.ok(!two.includes('das_nimbus'))
  assert.equal(two.split('OpenNMS UI Studio: icon mappings').length, 2, 'one block only')
  assert.equal(mergeMappings(two, {}), stock)
  assert.equal(mergeMappings(null, {}), '')
  assert.equal(escapeKey('a b:c=d'), 'a\\ b\\:c\\=d')
})

test('archives: tar from a container, the stylesheet inside a jar', () => {
  const dir = join(tmp, 'tar')
  mkdirSync(join(dir, 'graphml'), { recursive: true })
  writeFileSync(join(dir, 'graphml', 'Maven-abc.xml'), '<graphml/>')
  writeFileSync(join(dir, 'x.cfg'), 'a = b\n')
  const files = readTar(execFileSync('tar', ['-C', dir, '-cf', '-', 'graphml/Maven-abc.xml', 'x.cfg']))
  assert.equal(files.get('graphml/Maven-abc.xml')?.toString(), '<graphml/>')
  assert.equal(files.get('x.cfg')?.toString(), 'a = b\n')
  const jar = fixture('theme.jar')
  const css = readZipEntry(jar, 'VAADIN/themes/topo_default/styles.css')?.toString() ?? ''
  assert.ok(css.includes('.vertex .status.normal'))
  assert.equal(readZipEntry(jar, 'VAADIN/themes/topo_default/stored.txt')?.toString(), 'stored entry')
  assert.equal(readZipEntry(jar, 'missing.css'), null)
})

test('overlay names: the jetty-webapps overlay may be laid out from jetty-webapps/ or below it', () => {
  const jetty = OVERLAY_FOLDERS[0]
  assert.deepEqual(namesIn(jetty, 'jetty-webapps/opennms/ui/assets/index-1.js'), ['opennms/ui/assets/index-1.js', 'ui/assets/index-1.js', 'assets/index-1.js', 'index-1.js'])
  assert.deepEqual(namesIn(OVERLAY_FOLDERS[1], 'jetty-webapps/opennms/x.js'), ['jetty-webapps/opennms/x.js'])
  assert.deepEqual(namesIn(OVERLAY_FOLDERS[2], 'etc/a.cfg'), ['a.cfg'])
  assert.deepEqual(namesIn(OVERLAY_FOLDERS[2], 'jetty-webapps/a'), [])
})

test('shell quoting for the commands sent over ssh', () => {
  assert.equal(shellQuote('/usr/share/opennms/x.js'), '/usr/share/opennms/x.js')
  assert.equal(shellQuote('mkdir -p "$(dirname "$1")" && cat > "$1"'), `'mkdir -p "$(dirname "$1")" && cat > "$1"'`)
  assert.equal(shellQuote("it's"), `'it'\\''s'`)
  assert.equal(shellQuote(''), "''")
})
