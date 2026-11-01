// Unit tests of the parts of the studio that read and change OpenNMS files. Run: npm test
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { parseEnvFile } from '../src/config.js'
import type { StudioConfig } from '../src/config.js'
import type { Target } from '../src/target.js'
import { buildStyleSvg, forgetPreview, hasRules, iconsInfo, markId, markOn, mergeMappings, escapeKey, readIconCopies, removeIconCopy, repairIconCopy, topologyPlan, writeIconCopy } from '../src/modules/topology.js'
import { applyIconFix, checkIconFile, repairIconFile, validIconFileName } from '../src/util/iconcheck.js'
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

// ---- Icon files: the check, the repair, and the plan that sends your repaired copy ------------------------------------

/** An icon file made like the nimbus.svg of the production image: #nimbus holds its three drawings. */
const STACKED = `<?xml version="1.0" encoding="UTF-8"?>\r
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 186" width="100%" height="100%">
    <defs>
        <style>
            .cls-1 { fill: #bcbec0; }
            .rollover-cls-1 { fill: #5dc3ad; }
            .active-cls-1 { fill: #b3b3b3; }
        </style>
    </defs>
    <g id="nimbus">
        <g id="nimbus_default"><path class="cls-1" d="M0,0h10v10z"/><rect class="cls-1" x="1" y="1" width="3" height="3"/></g>
        <g id="nimbus_rollover"><path class="rollover-cls-1" d="M0,0h10v10z"/><rect class="rollover-cls-1" x="1" y="1" width="3" height="3"/></g>
        <g id="nimbus_active"><path class="active-cls-1" d="M0,0h10v10z"/><rect class="active-cls-1" x="1" y="1" width="3" height="3"/></g>
    </g>
</svg>
`

/** The same drawing built the way OpenNMS wants it (the stock files do it so). */
const WELL_FORMED = STACKED.replace('<g id="nimbus">', '<g id="nimbus_icon">').replace('<g id="nimbus_default">', '<g id="nimbus">')

test('icon check: a file whose icon holds its rollover and active drawings is found, with the drawing you see', () => {
  const check = checkIconFile('nimbus.svg', STACKED)
  assert.equal(check.problems.length, 1)
  const [p] = check.problems
  assert.equal(p.kind, 'stacked')
  assert.equal(p.severity, 'error')
  assert.equal(p.icon, 'nimbus')
  assert.deepEqual(check.icons[0].stacked, ['nimbus_default', 'nimbus_rollover', 'nimbus_active'])
  assert.equal(check.icons[0].visible, 'nimbus_active', 'the last drawing in the file is on top')
  assert.deepEqual(p.fix?.renames, [
    { from: 'nimbus', to: 'nimbus_icon' },
    { from: 'nimbus_default', to: 'nimbus' },
  ])
  assert.match(p.message, /#nimbus_active, is on top/)
})

test('icon check: the repair changes the two ids and nothing else, also with CRLF line ends', () => {
  const repaired = repairIconFile('nimbus.svg', STACKED)
  assert.equal(repaired.text, WELL_FORMED)
  assert.equal(repaired.left.length, 0)
  const changed = STACKED.split('\n').filter((line, i) => line !== repaired.text.split('\n')[i])
  assert.equal(changed.length, 2)
  assert.ok(repaired.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\r\n'))
  // And the repaired file is clean.
  const again = checkIconFile('nimbus.svg', repaired.text)
  assert.deepEqual(again.problems, [])
  assert.deepEqual(again.icons[0].stacked, [])
  assert.equal(again.icons[0].hasWrapper, true)
  // Run again: nothing left to do.
  assert.equal(repairIconFile('nimbus.svg', repaired.text).applied.length, 0)
})

test('icon check: a file with a _default group but no normal group, and a file that refers to its own ids', () => {
  const lonely = WELL_FORMED.replace('<g id="nimbus">', '<g id="nimbus_default">')
  const c = checkIconFile('nimbus.svg', lonely)
  assert.deepEqual(c.problems.map((p) => `${p.kind}:${p.severity}`), ['default-group:error'])
  assert.deepEqual(c.problems[0].fix?.renames, [{ from: 'nimbus_default', to: 'nimbus' }])
  assert.equal(repairIconFile('nimbus.svg', lonely).text, WELL_FORMED)

  // A rule inside the file names the group: renaming it would change what the rule means, so no repair is offered.
  const withRule = STACKED.replace('.cls-1 { fill: #bcbec0; }', '#nimbus_default .cls-1 { fill: #bcbec0; }')
  const r = checkIconFile('nimbus.svg', withRule).problems[0]
  assert.equal(r.fix, null)
  assert.match(r.noFix ?? '', /refers to/)
  assert.equal(repairIconFile('nimbus.svg', withRule).applied.length, 0)
  assert.throws(() => applyIconFix(STACKED, { summary: 'x', renames: [{ from: 'nope', to: 'y' }] }), /expects one/)
})

test('icon check: well-formed, style-only, stock and odd files', () => {
  assert.deepEqual(checkIconFile('good.svg', WELL_FORMED).problems, [])
  // Only a stylesheet: nothing to draw, and nothing wrong.
  assert.deepEqual(checkIconFile('style.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><style><![CDATA[ .a > .b { fill: red } ]]></style></svg>').problems, [])
  // Neither: a note.
  assert.equal(checkIconFile('empty.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>').problems[0].kind, 'no-drawing')
  // OpenNMS's own files are not checked, however they are built.
  assert.deepEqual(checkIconFile('opennms_icons.svg', STACKED).problems, [])
  assert.equal(checkIconFile('opennms_icons.svg', STACKED).stock, true)
  // A drawing without rollover and active looks: a note, not an error.
  const lone = checkIconFile('one.svg', '<svg xmlns="http://www.w3.org/2000/svg"><g id="das_nimbus"><path d="M0,0z"/></g></svg>')
  assert.deepEqual(lone.problems.map((p) => `${p.kind}:${p.severity}:${p.icon}`), ['missing-state:note:das_nimbus'])
  // Illustrator files: a doctype with an internal subset, ">" inside an attribute value, comments with tags in them.
  const illustrator = `<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
  <!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
]>
<svg xmlns="http://www.w3.org/2000/svg"><!-- <g id="x_rollover"> is only a comment -->
  <g id="x_icon" data-note="a>b"><g id="x"><path d="M0,0z"/></g><g id="x_rollover"><path d="M0,0z"/></g><g id="x_active"/></g></svg>`
  assert.deepEqual(checkIconFile('ai.svg', illustrator).problems, [])
  assert.equal(validIconFileName('nimbus.svg'), true)
  for (const bad of ['../x.svg', 'a/b.svg', 'x.css', '.svg', 'zz-topology-styles.svg', 'zz-topology-styles-2.svg', '']) assert.equal(validIconFileName(bad), false, bad)
})

// A stand-in for an OpenNMS: it answers the few questions the plan asks, from a map of files.
function fakeOpenNMS(files: Record<string, string>): Target {
  const bytes = (rel: string) => (rel in files ? Buffer.from(files[rel]) : null)
  return {
    name: 'dev',
    title: 'the development OpenNMS',
    where: 'a stand-in',
    settings: { container: 'x', url: 'http://127.0.0.1:1/opennms', user: '', password: '' },
    home: async () => '/usr/share/opennms',
    abs: async (rel: string) => `/usr/share/opennms/${rel}`,
    read: async (rel: string) => bytes(rel),
    readAbs: async (path: string) => bytes(path.replace('/usr/share/opennms/', '')),
    md5Abs: async (path: string) => {
      const b = bytes(path.replace('/usr/share/opennms/', ''))
      return b ? md5Of(b) : null
    },
    readMany: async (dir: string, patterns: string[]) => {
      const out = new Map<string, Buffer>()
      if (patterns.includes('*.svg')) for (const rel of Object.keys(files)) if (rel.startsWith(`${dir}/`) && rel.endsWith('.svg') && !rel.slice(dir.length + 1).includes('/')) out.set(rel.slice(dir.length + 1), Buffer.from(files[rel]))
      return out
    },
    exec: async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
    http: async () => ({ ok: false, status: 0, headers: {}, body: Buffer.alloc(0), error: 'no network in the test' }),
  } as unknown as Target
}
const md5Of = (b: Buffer) => createHash('md5').update(b).digest('hex')
function studioConfig(name: string): StudioConfig {
  const workspace = join(tmp, name, 'workspace')
  mkdirSync(join(workspace, 'topology'), { recursive: true })
  return { root, kitDir: join(root, 'kit'), workspace, backups: join(tmp, name, 'backups') } as unknown as StudioConfig
}
const SVG = 'jetty-webapps/opennms/svg'

test('icon copies: the report, the repaired copy, and the plan that sends it', async () => {
  forgetPreview()
  const config = studioConfig('icons')
  const dev = fakeOpenNMS({ [`${SVG}/nimbus.svg`]: STACKED, [`${SVG}/good.svg`]: WELL_FORMED, [`${SVG}/opennms_icons.svg`]: STACKED })

  let info = await iconsInfo(config, dev, true)
  assert.deepEqual(info.files.map((f) => f.name), ['good.svg', 'nimbus.svg', 'opennms_icons.svg'])
  assert.deepEqual(info.files.map((f) => f.problems.filter((p) => p.severity === 'error').length), [0, 1, 0])
  assert.equal(info.files[1].copy, null)

  // No copy yet: the plan holds the style file only.
  assert.deepEqual((await topologyPlan(config, dev)).map((f) => f.rel), [`${SVG}/zz-topology-styles.svg`])

  // Make the copy: the studio repairs what it can, from the file of that OpenNMS.
  await repairIconCopy(config, dev, 'nimbus.svg')
  assert.deepEqual(readIconCopies(config).map((c) => c.name), ['nimbus.svg'])
  assert.equal(readIconCopies(config)[0].content.toString(), WELL_FORMED)
  forgetPreview()
  info = await iconsInfo(config, dev, true)
  const nimbus = info.files.find((f) => f.name === 'nimbus.svg')
  assert.equal(nimbus?.copy?.problems.length, 0, 'the copy is clean')
  assert.equal(nimbus?.copy?.same, false)
  assert.equal(nimbus?.problems.length, 1, 'the file of that OpenNMS still has the flaw until the apply')
  assert.deepEqual(info.workspace.map((w) => w.name), ['nimbus.svg'])

  // The plan sends the copy, as a file of the svg folder, with the two changed ids in the diff.
  const plan = await topologyPlan(config, dev)
  assert.deepEqual(plan.map((f) => f.rel), [`${SVG}/zz-topology-styles.svg`, `${SVG}/nimbus.svg`])
  const file = plan[1]
  assert.equal(file.md5After, md5Of(Buffer.from(WELL_FORMED)))
  assert.equal(file.md5Before, md5Of(Buffer.from(STACKED)))
  assert.match(file.diff, /-\s+<g id="nimbus">/)
  assert.match(file.diff, /\+\s+<g id="nimbus_icon">/)
  assert.match(file.why, /your copy of nimbus\.svg/)
  assert.equal(file.ownedByOpenNMS, false)

  // Once that OpenNMS has the copy, there is nothing to send.
  const applied = fakeOpenNMS({ [`${SVG}/nimbus.svg`]: WELL_FORMED })
  assert.deepEqual((await topologyPlan(config, applied)).map((f) => f.rel), [`${SVG}/zz-topology-styles.svg`])

  // A repaired copy of a good file, or a name that is not a name: errors that say why.
  await assert.rejects(() => repairIconCopy(config, dev, 'good.svg'), /nothing to repair/)
  await assert.rejects(() => repairIconCopy(config, dev, '../etc.svg'), /Not a name/)
  await assert.rejects(() => repairIconCopy(config, dev, 'missing.svg'), /is not in/)

  // Removing the copy: the studio sends nothing again.
  assert.equal(removeIconCopy(config, 'nimbus.svg'), true)
  assert.equal(removeIconCopy(config, 'nimbus.svg'), false)
  assert.deepEqual((await topologyPlan(config, dev)).map((f) => f.rel), [`${SVG}/zz-topology-styles.svg`])
})

test('icon copies: a file you put into the workspace yourself is sent, as a new file', async () => {
  forgetPreview()
  const config = studioConfig('icons-new')
  const dev = fakeOpenNMS({})
  writeIconCopy(config, 'stratus.svg', WELL_FORMED)
  assert.throws(() => writeIconCopy(config, 'zz-topology-styles.svg', 'x'), /Not a name/)
  const info = await iconsInfo(config, dev, true)
  assert.deepEqual(info.files.map((f) => [f.name, f.missing, f.copy?.problems.length]), [['stratus.svg', true, 0]])
  const plan = await topologyPlan(config, dev)
  assert.equal(plan[1].rel, `${SVG}/stratus.svg`)
  assert.equal(plan[1].md5Before, null)
  assert.match(plan[1].why, /new file: open the page in a new browser tab/)
})

test('a diff of a drawing shows the beginning of its very long lines, not all of them', async () => {
  const { unifiedDiff } = await import('../src/util/diff.js')
  const long = `<path d="${'M0,0h10v10z'.repeat(400)}"/>`
  const diff = await unifiedDiff(`<g id="a">\n${long}\n</g>\n`, `<g id="b">\n${long}\n</g>\n`, 'x.svg')
  assert.match(diff, /-<g id="a">/)
  assert.match(diff, /\+<g id="b">/)
  assert.ok(diff.length < 1500, `the diff is ${diff.length} characters`)
  assert.match(diff, /more characters\]/)
})
