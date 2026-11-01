// Module "topology": the look of /opennms/topology and the icon of each node.
//
// Your files (workspace/)                     The OpenNMS file it becomes (below OpenNMS's home)
//   topology/topology.css              ->     jetty-webapps/opennms/svg/zz-topology-styles.svg
//   topology/icon-mappings.json        ->     lines in etc/org.opennms.features.topology.app.icons.default.cfg
//   topology/icons/<name>.svg          ->     jetty-webapps/opennms/svg/<name>.svg     (your copy of an icon file)
//
// Why an svg file: OpenNMS puts every file of jetty-webapps/opennms/svg/ into the topology page (inside <defs>),
// so a <style> in one of them styles the whole page. The studio writes your CSS into such a file, byte for byte as
// the topology kit (kit/topo.sh) does, so that both tools agree on what production has.
// Why the cfg file: OpenNMS reads icon mappings (<namespace>.<node id> = <icon id>) from the files
// etc/org.opennms.features.topology.app.icons.*.cfg, and picks up a changed file within a second.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StudioConfig } from '../config.js'
import { applyChanges, type ApplyRecord, type Check, type FileChange } from '../changes.js'
import { step } from '../events.js'
import type { History } from '../history.js'
import { planOverlay } from '../overlay.js'
import { md5, type Target } from '../target.js'
import { readZipEntry } from '../util/archive.js'
import { unifiedDiff } from '../util/diff.js'
import { checkIconFile, repairIconFile, STOCK_ICON_FILES, validIconFileName, type IconFileCheck, type IconInfo, type IconProblem } from '../util/iconcheck.js'

export const SVG_DIR = 'jetty-webapps/opennms/svg'
export const STYLE_REL = `${SVG_DIR}/zz-topology-styles.svg`
export const MAPPING_REL = 'etc/org.opennms.features.topology.app.icons.default.cfg'
/** The name the generated file mentions: the topology kit's name for the CSS, whatever its real path. */
const STYLE_NAME = 'styles/topology.css'
const THEME_JAR_DIR = 'system/org/opennms/features/topology/themes/org.opennms.features.topology.themes.default-theme'
const THEME_CSS = 'VAADIN/themes/topo_default/styles.css'

export const cssFile = (config: StudioConfig) => join(config.workspace, 'topology', 'topology.css')
export const mappingsFile = (config: StudioConfig) => join(config.workspace, 'topology', 'icon-mappings.json')
export const iconsDir = (config: StudioConfig) => join(config.workspace, 'topology', 'icons')

// ---- The style file -------------------------------------------------------------------------------------------

const MARK_LINE = /^[ \t\v\f\r]*\/\*[ \t\v\f\r]*mark[ \t\v\f\r]*\*\/[ \t\v\f\r]*$/m

/** A line with only the comment mark: the page then shows a label with the version of the CSS. */
export function markOn(css: string): boolean {
  return MARK_LINE.test(css)
}

/** What the label says: 6 characters of the md5 sum of the CSS file. */
export function markId(css: Buffer): string {
  return md5(css).slice(0, 6)
}

/** Anything besides comments and white space (or the mark line). */
export function hasRules(css: string): boolean {
  return markOn(css) || css.replace(/\/\*[\s\S]*?\*\//g, '').trim() !== ''
}

/** The svg file for the CSS, byte for byte what kit/topo.sh makes (style_svg). */
export function buildStyleSvg(css: Buffer): Buffer {
  const text = css.toString('latin1') // bytes kept as they are
  let out =
    `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><!-- Made by topo.sh from ${STYLE_NAME}. -->\n<style><![CDATA[\n` +
    text.replace(/]]>/g, ']]]]><![CDATA[>')
  if (markOn(text)) {
    out +=
      `\n/* The label at the bottom left of the page: this CSS reached it. It shows the version of ${STYLE_NAME} (6 characters of its md5). */\n` +
      `body::after { content: "topology.css ${markId(css)}"; position: fixed; left: 8px; bottom: 8px; z-index: 99999; padding: 2px 8px; border-radius: 3px; background: #ffe066; color: #000; font: 12px/1.4 monospace; pointer-events: none; }\n`
  }
  out += ']]></style></svg>\n'
  return Buffer.from(out, 'latin1')
}

// ---- Icon mappings ----------------------------------------------------------------------------------------------

const BLOCK_BEGIN = '# --- OpenNMS UI Studio: icon mappings. The studio writes the lines between these two comments. ---'
const BLOCK_END = '# --- end of the OpenNMS UI Studio icon mappings ---'

/** A key of a .cfg (properties) file: ':' '=' ' ' '#' '!' and '\' need a backslash. */
export function escapeKey(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/([:= #!])/g, '\\$1')
}

export function validMappingKey(key: string): boolean {
  return /^[^\s=\\]+\.[^\s=\\]+$/.test(key) && key.length <= 200
}

export function validIconId(icon: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,100}$/.test(icon)
}

/** The cfg file with the studio's block replaced (or added at the end, where it wins over earlier lines). */
export function mergeMappings(current: string | null, mappings: Record<string, string>): string {
  let text = current ?? ''
  const begin = text.indexOf(BLOCK_BEGIN)
  if (begin >= 0) {
    const endAt = text.indexOf(BLOCK_END, begin)
    const stop = endAt >= 0 ? text.indexOf('\n', endAt) : -1
    const before = text.slice(0, begin).replace(/\n+$/, '\n')
    text = before + (stop >= 0 ? text.slice(stop + 1) : '')
  }
  const keys = Object.keys(mappings).sort()
  if (keys.length === 0) return text
  if (text && !text.endsWith('\n')) text += '\n'
  const lines = keys.map((k) => `${escapeKey(k)} = ${mappings[k]}`)
  return `${text}${text ? '\n' : ''}${BLOCK_BEGIN}\n${lines.join('\n')}\n${BLOCK_END}\n`
}

// ---- The workspace ----------------------------------------------------------------------------------------------

export function readCss(config: StudioConfig): Buffer {
  const f = cssFile(config)
  return existsSync(f) ? readFileSync(f) : Buffer.alloc(0)
}

export function writeCss(config: StudioConfig, css: string): void {
  mkdirSync(join(config.workspace, 'topology'), { recursive: true })
  writeFileSync(cssFile(config), css)
}

export function readMappings(config: StudioConfig): Record<string, string> {
  const f = mappingsFile(config)
  if (!existsSync(f)) return {}
  try {
    const data = JSON.parse(readFileSync(f, 'utf8')) as Record<string, string>
    return Object.fromEntries(Object.entries(data).filter(([k, v]) => validMappingKey(k) && validIconId(v)))
  } catch {
    return {}
  }
}

export function writeMappings(config: StudioConfig, mappings: Record<string, string>): void {
  for (const [k, v] of Object.entries(mappings)) {
    if (!validMappingKey(k)) throw new Error(`Not a mapping key: ${k} (it is <namespace>.<node id>)`)
    if (!validIconId(v)) throw new Error(`Not an icon id: ${v}`)
  }
  const sorted = Object.fromEntries(Object.keys(mappings).sort().map((k) => [k, mappings[k]]))
  writeFileSync(mappingsFile(config), JSON.stringify(sorted, null, 2) + '\n')
}

// ---- Your copies of icon files (workspace/topology/icons/<name>.svg) ------------------------------------------------

export interface IconCopy {
  name: string
  content: Buffer
}

/** The icon files in your workspace, by name. A file there goes to jetty-webapps/opennms/svg/ of the OpenNMS you apply to. */
export function readIconCopies(config: StudioConfig): IconCopy[] {
  const dir = iconsDir(config)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(validIconFileName)
    .sort()
    .map((name) => ({ name, content: readFileSync(join(dir, name)) }))
}

export function writeIconCopy(config: StudioConfig, name: string, content: Buffer | string): void {
  if (!validIconFileName(name)) throw new Error(`Not a name for an icon file: ${name} (letters, digits, . _ - and the ending .svg; not zz-topology-styles...)`)
  mkdirSync(iconsDir(config), { recursive: true })
  writeFileSync(join(iconsDir(config), name), content)
}

export function removeIconCopy(config: StudioConfig, name: string): boolean {
  if (!validIconFileName(name)) throw new Error(`Not a name for an icon file: ${name}`)
  const file = join(iconsDir(config), name)
  if (!existsSync(file)) return false
  rmSync(file)
  return true
}

export function summary(config: StudioConfig) {
  const css = readCss(config)
  const svg = buildStyleSvg(css)
  return {
    cssPath: 'workspace/topology/topology.css',
    css: css.toString('utf8'),
    mappings: readMappings(config),
    iconCopies: readIconCopies(config).map((c) => c.name),
    hasRules: hasRules(css.toString('utf8')),
    mark: markOn(css.toString('utf8')) ? markId(css) : null,
    generated: { rel: STYLE_REL, md5: md5(svg), size: svg.length, text: svg.toString('utf8') },
  }
}

// ---- What an OpenNMS has (for the preview and the state) ------------------------------------------------------

export interface PreviewData {
  target: string
  svgFiles: { name: string; text: string }[]
  views: { file: string; text: string }[]
  viewConfigs: { file: string; text: string }[]
  mappingFiles: { file: string; text: string }[]
  stockCss: string
  stockCssFrom: string
  styleFileThere: string | null
}

const cache = new Map<string, { at: number; data: PreviewData }>()

/** After an apply or an undo: what the studio read from that OpenNMS is old now. */
export function forgetPreview(target?: string): void {
  if (target) cache.delete(target)
  else cache.clear()
}

export async function previewData(config: StudioConfig, t: Target, refresh = false): Promise<PreviewData> {
  const hit = cache.get(t.name)
  if (hit && !refresh && Date.now() - hit.at < 120000) return hit.data
  const svgs = await t.readMany(SVG_DIR, ['*.svg'])
  const etc = await t.readMany('etc', [
    'graphml/*.xml',
    'org.opennms.features.topology.app.icons.*.cfg',
    'org.opennms.features.topology.plugins.topo.graphml-*.cfg',
  ])
  let stockCss = ''
  let stockCssFrom = ''
  const home = await t.home()
  const found = await t.exec(['sh', '-c', 'ls "$1"/*/*.jar 2>/dev/null | head -n 1', 'sh', `${home}/${THEME_JAR_DIR}`])
  const jar = found.stdout.toString().trim()
  if (jar) {
    const bytes = await t.readAbs(jar)
    const css = bytes ? readZipEntry(bytes, THEME_CSS) : null
    if (css) {
      stockCss = css.toString('utf8')
      stockCssFrom = `${jar} (${THEME_CSS} inside the jar)`
    }
  }
  if (!stockCss) {
    stockCss = readFileSync(join(config.root, 'server', 'assets', 'topo_default-styles.css'), 'utf8')
    stockCssFrom = 'the copy of the stock 33.1.8 file in the studio (server/assets/topo_default-styles.css): the theme jar was not found there'
  }
  const style = svgs.get('zz-topology-styles.svg')
  const data: PreviewData = {
    target: t.name,
    svgFiles: [...svgs.entries()]
      .filter(([name]) => !name.startsWith('zz-topology-styles'))
      .map(([name, b]) => ({ name, text: b.toString('utf8') }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    views: [...etc.entries()].filter(([f]) => f.startsWith('graphml/')).map(([file, b]) => ({ file, text: b.toString('utf8') })),
    viewConfigs: [...etc.entries()].filter(([f]) => f.includes('topo.graphml-')).map(([file, b]) => ({ file, text: b.toString('utf8') })),
    mappingFiles: [...etc.entries()].filter(([f]) => f.includes('.icons.')).map(([file, b]) => ({ file, text: b.toString('utf8') })),
    stockCss,
    stockCssFrom,
    styleFileThere: style ? style.toString('utf8') : null,
  }
  cache.set(t.name, { at: Date.now(), data })
  return data
}

export async function topologyState(config: StudioConfig, t: Target) {
  const svg = buildStyleSvg(readCss(config))
  const expected = md5(svg)
  const inContainer = await t.md5Abs(await t.abs(STYLE_REL))
  const served = await t.http('svg/zz-topology-styles.svg')
  const plan = await planOverlay(t, STYLE_REL)
  const overlays = []
  for (const c of plan.copies) overlays.push({ onHost: c.onHost, md5: c.exists ? await t.md5Abs(c.inContainer) : null })
  const cfg = await t.read(MAPPING_REL, true)
  const merged = mergeMappings(cfg ? cfg.toString('utf8') : null, readMappings(config))
  const icons: { name: string; rel: string; same: boolean; present: boolean }[] = []
  for (const copy of readIconCopies(config)) {
    const rel = `${SVG_DIR}/${copy.name}`
    const now = await t.md5Abs(await t.abs(rel))
    icons.push({ name: copy.name, rel, same: now === md5(copy.content), present: now !== null })
  }
  return {
    target: t.name,
    where: t.where,
    style: {
      rel: STYLE_REL,
      expected,
      inContainer,
      same: inContainer === expected,
      served: served.status
        ? { status: served.status, same: md5(served.body) === expected, cacheControl: served.headers['cache-control'] ?? null }
        : { status: 0, same: false, cacheControl: null, error: served.error },
      overlays,
      overlayNote: plan.note,
    },
    mappings: { rel: MAPPING_REL, upToDate: !!cfg && merged === cfg.toString('utf8') || (!cfg && Object.keys(readMappings(config)).length === 0) },
    icons,
  }
}

// ---- The icon files: what is wrong with them, and your repaired copies ------------------------------------------------

export interface IconFileReport extends IconFileCheck {
  /** The OpenNMS has no file of this name (your copy in the workspace would add it) */
  missing: boolean
  /** Your copy in workspace/topology/icons/, if there is one */
  copy: null | { size: number; md5: string; same: boolean; icons: IconInfo[]; problems: IconProblem[] }
}

export interface IconsInfo {
  target: string
  files: IconFileReport[]
  /** The text of your copies: the preview uses them in place of the OpenNMS files of the same name */
  workspace: { name: string; text: string }[]
}

export async function iconsInfo(config: StudioConfig, t: Target, refresh = false): Promise<IconsInfo> {
  const data = await previewData(config, t, refresh)
  const copies = readIconCopies(config)
  const names = [...new Set([...data.svgFiles.map((f) => f.name), ...copies.map((c) => c.name)])].sort()
  const files: IconFileReport[] = names.map((name) => {
    const there = data.svgFiles.find((f) => f.name === name)
    const copy = copies.find((c) => c.name === name)
    const check: IconFileCheck = there
      ? checkIconFile(name, there.text.replace(/^\uFEFF/, ''))
      : { name, stock: STOCK_ICON_FILES.has(name), hasStyle: false, icons: [], problems: [] }
    let copyInfo: IconFileReport['copy'] = null
    if (copy) {
      const mine = checkIconFile(name, copy.content.toString('utf8').replace(/^\uFEFF/, ''))
      copyInfo = { size: copy.content.length, md5: md5(copy.content), same: !!there && md5(Buffer.from(there.text)) === md5(copy.content), icons: mine.icons, problems: mine.problems }
    }
    return { ...check, missing: !there, copy: copyInfo }
  })
  return { target: t.name, files, workspace: copies.map((c) => ({ name: c.name, text: c.content.toString('utf8') })) }
}

/**
 * Makes your copy of an icon file with the flaws repaired that can be repaired without guessing (an icon whose
 * group holds its own rollover and active drawings: two ids change). The source is your copy, or else the file of that
 * OpenNMS as it is now. Returns what was done.
 */
export async function repairIconCopy(config: StudioConfig, t: Target, name: string): Promise<{ applied: string[]; left: string[] }> {
  if (!validIconFileName(name)) throw new Error(`Not a name for an icon file: ${name}`)
  const mine = readIconCopies(config).find((c) => c.name === name)
  const source = mine?.content ?? (await t.read(`${SVG_DIR}/${name}`))
  if (!source) throw new Error(`${name} is not in ${t.title} and not in workspace/topology/icons/.`)
  const bom = source.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  const text = source.toString('utf8').replace(/^\uFEFF/, '')
  const repaired = repairIconFile(name, text)
  if (repaired.applied.length === 0) {
    const why = checkIconFile(name, text).problems.filter((p) => p.severity === 'error').map((p) => p.noFix ?? p.message)
    throw new Error(why.length ? `Nothing in ${name} can be repaired without guessing. ${why.join(' ')}` : `${name} has nothing to repair.`)
  }
  writeIconCopy(config, name, Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(repaired.text, 'utf8')]))
  step('workspace', `Wrote workspace/topology/icons/${name}: ${repaired.applied.map((a) => a.summary).join('; ')}.`)
  return { applied: repaired.applied.map((a) => a.summary), left: repaired.left.map((p) => p.message) }
}

// ---- Plan and apply ---------------------------------------------------------------------------------------------

export interface PlannedFile {
  rel: string
  why: string
  md5Before: string | null
  md5After: string
  same: boolean
  diff: string
  overlays: string[]
  overlayNote: string
  /** A file that comes with OpenNMS itself: an upgrade brings a new version of it (the page says what to do then) */
  ownedByOpenNMS?: boolean
}

async function changesFor(config: StudioConfig, t: Target): Promise<{ changes: FileChange[]; before: Map<string, Buffer | null> }> {
  const before = new Map<string, Buffer | null>()
  const svg = buildStyleSvg(readCss(config))
  before.set(STYLE_REL, await t.read(STYLE_REL, true))
  const changes: FileChange[] = [
    { rel: STYLE_REL, content: svg, why: 'your topology.css, in the svg file that OpenNMS puts into the topology page' },
  ]
  const cfg = await t.read(MAPPING_REL, true)
  before.set(MAPPING_REL, cfg)
  const merged = mergeMappings(cfg ? cfg.toString('utf8') : null, readMappings(config))
  if (merged !== (cfg ? cfg.toString('utf8') : '')) {
    changes.push({ rel: MAPPING_REL, content: Buffer.from(merged), why: 'your icon mappings (<namespace>.<node id> = <icon id>), in the block of the studio' })
  }
  // Your copies of icon files (workspace/topology/icons/): a file is sent when the OpenNMS has another version of it.
  for (const copy of readIconCopies(config)) {
    const rel = `${SVG_DIR}/${copy.name}`
    const now = await t.read(rel, true)
    before.set(rel, now)
    if (!now || md5(now) !== md5(copy.content)) {
      changes.push({
        rel,
        content: copy.content,
        why: `your copy of ${copy.name} (workspace/topology/icons/${copy.name}); OpenNMS puts every svg file of this folder into the topology page${now ? '' : ' (a new file: open the page in a new browser tab)'}`,
      })
    }
  }
  return { changes, before }
}

export async function topologyPlan(config: StudioConfig, t: Target): Promise<PlannedFile[]> {
  const { changes, before } = await changesFor(config, t)
  const out: PlannedFile[] = []
  for (const c of changes) {
    const old = before.get(c.rel) ?? null
    const plan = await planOverlay(t, c.rel)
    out.push({
      rel: c.rel,
      why: c.why,
      md5Before: old ? md5(old) : null,
      md5After: md5(c.content),
      same: !!old && md5(old) === md5(c.content),
      diff: await unifiedDiff(old, c.content, c.rel, `${t.name} now`, 'after the apply'),
      overlays: plan.copies.map((x) => `${x.onHost}${x.exists ? '' : ' (new)'}`),
      overlayNote: plan.note,
      ownedByOpenNMS: STOCK_ICON_FILES.has(c.rel.slice(c.rel.lastIndexOf('/') + 1)) && c.rel.startsWith(`${SVG_DIR}/`),
    })
  }
  return out
}

export async function applyTopology(config: StudioConfig, history: History, t: Target): Promise<ApplyRecord> {
  const { changes } = await changesFor(config, t)
  const commit = (await history.snapshot(`Apply the topology to ${t.name}`, ['topology'])) ?? (await history.head())
  const expected = md5(changes[0].content)
  const record = await applyChanges(config, t, 'topology', changes, commit, async (): Promise<Check[]> => {
    const served = await t.http('svg/zz-topology-styles.svg')
    const check: Check = served.status
      ? {
          what: `OpenNMS serves svg/zz-topology-styles.svg (asked from this machine: ${t.settings.url})`,
          ok: served.status === 200 && md5(served.body) === expected,
          detail: served.status === 200 ? (md5(served.body) === expected ? `200, the new file; Cache-Control: ${served.headers['cache-control'] ?? 'none'}` : '200, but another text (a proxy or cache in between?)') : `HTTP ${served.status}`,
        }
      : { what: 'OpenNMS serves svg/zz-topology-styles.svg', ok: null, detail: served.error ?? 'no answer' }
    const checks: Check[] = [check]
    for (const c of changes.filter((x) => x.rel.startsWith(`${SVG_DIR}/`) && x.rel !== STYLE_REL)) {
      const name = c.rel.slice(SVG_DIR.length + 1)
      const answer = await t.http(`svg/${name}`)
      checks.push(
        answer.status
          ? {
              what: `OpenNMS serves svg/${name} (your copy)`,
              ok: answer.status === 200 && md5(answer.body) === md5(c.content),
              detail: answer.status === 200 ? (md5(answer.body) === md5(c.content) ? `200, the new file; Cache-Control: ${answer.headers['cache-control'] ?? 'none'}` : '200, but another text (a proxy or cache in between?)') : `HTTP ${answer.status}`,
            }
          : { what: `OpenNMS serves svg/${name}`, ok: null, detail: answer.error ?? 'no answer' },
      )
    }
    return checks
  })
  forgetPreview(t.name)
  // The topology kit remembers which style file production has (kit/.kit/prod-style): keep it right.
  if (t.name === 'prod' && existsSync(join(config.kitDir, '.kit'))) writeFileSync(join(config.kitDir, '.kit', 'prod-style'), expected + '\n')
  return record
}
