// Module "menu": the words in the menu bar at the top of every OpenNMS page.
//
// OpenNMS 33.1.8 draws that bar twice, with two different programs:
//   - the JSP pages (index.jsp, the node pages, ... and the topology map) get it from NavBarController, which fills
//     the template jetty-webapps/opennms/WEB-INF/templates/navbar.ftl;
//   - the pages of the newer Vue app (/opennms/ui/#/..., which includes every plugin page) draw their own bar:
//     Menubar.vue, compiled into a JavaScript file jetty-webapps/opennms/ui/assets/index-<hash>.js.
// Where a word comes from decides what you must change:
//   - Search, Info, Status, Reports, Dashboards, Maps and their entries: jetty-webapps/opennms/WEB-INF/dispatcher-servlet.xml.
//     Both bars read it. The Vue bar reads it at every page load (/opennms/api/v2/menu); the JSP bar reads it when
//     OpenNMS starts (it is a Spring bean), so the JSP bar shows a new name after a restart only.
//   - Plugins: written into navbar.ftl AND into Menubar.vue. Change both, or the two bars disagree.
//   - Help, About, the user menu, Quick-Add Node, ...: navbar.ftl and MenuProvider.java (compiled into a jar):
//     the Vue bar's words need a new build of OpenNMS, so the studio only shows them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StudioConfig } from '../config.js'
import { applyChanges, type ApplyRecord, type Check, type FileChange } from '../changes.js'
import type { History } from '../history.js'
import { planOverlay } from '../overlay.js'
import { md5, type Target } from '../target.js'
import { excerpt, unifiedDiff } from '../util/diff.js'

export const NAVBAR_REL = 'jetty-webapps/opennms/WEB-INF/templates/navbar.ftl'
export const DISPATCHER_REL = 'jetty-webapps/opennms/WEB-INF/dispatcher-servlet.xml'
export const ASSETS_DIR = 'jetty-webapps/opennms/ui/assets'
export const UI_INDEX_REL = 'jetty-webapps/opennms/ui/index.html'
/** The class of the buttons of the Vue menu bar: it marks the compiled Menubar in a bundle. */
export const MENUBAR_MARK = 'menubar-dropdown-button-dark'

export const labelsFile = (config: StudioConfig) => join(config.workspace, 'menu', 'labels.json')

export interface Labels {
  /** The text of the Plugins menu; null: leave it as OpenNMS has it */
  plugins: string | null
  /** New names for entries of dispatcher-servlet.xml, by id (<url>#<n>) */
  menuNames: Record<string, string>
}

const LABEL_RE = /^[\p{L}\p{N} _.,:;!?()&/+'’-]{1,40}$/u

export function validLabel(text: string): boolean {
  return text === text.trim() && LABEL_RE.test(text)
}

export function readLabels(config: StudioConfig): Labels {
  const f = labelsFile(config)
  if (!existsSync(f)) return { plugins: null, menuNames: {} }
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as Partial<Labels>
    return { plugins: raw.plugins ?? null, menuNames: raw.menuNames ?? {} }
  } catch {
    return { plugins: null, menuNames: {} }
  }
}

export function writeLabels(config: StudioConfig, labels: Labels): void {
  if (labels.plugins !== null && !validLabel(labels.plugins)) {
    throw new Error('A label has 1 to 40 letters, digits, spaces and . , : ; ! ? ( ) & / + \' - (no < > " $ { } # or quotes)')
  }
  for (const [id, name] of Object.entries(labels.menuNames)) {
    if (!validLabel(name)) throw new Error(`Not a valid name for ${id}: ${name}`)
  }
  mkdirSync(join(config.workspace, 'menu'), { recursive: true })
  writeFileSync(labelsFile(config), JSON.stringify({ plugins: labels.plugins, menuNames: labels.menuNames }, null, 2) + '\n')
}

const htmlDecode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const htmlEncode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const lineOf = (text: string, at: number) => text.slice(0, at).split('\n').length

// ---- navbar.ftl -------------------------------------------------------------------------------------------------

export interface Found {
  start: number
  end: number
  text: string
  line: number
}

/** The text of <a name="nav-plugin-top" ...>Plugins</a> in navbar.ftl. */
export function findNavbarLabel(ftl: string, anchor = 'nav-plugin-top'): Found | null {
  const m = new RegExp(`<a\\s[^>]*\\bname="${anchor}"[^>]*>([^<]*)</a>`).exec(ftl)
  if (!m) return null
  const start = m.index + m[0].indexOf('>') + 1
  return { start, end: start + m[1].length, text: htmlDecode(m[1]).trim(), line: lineOf(ftl, start) }
}

export function setNavbarLabel(ftl: string, text: string): string {
  const f = findNavbarLabel(ftl)
  if (!f) throw new Error('navbar.ftl has no <a name="nav-plugin-top"> (another OpenNMS version?)')
  return ftl.slice(0, f.start) + htmlEncode(text) + ftl.slice(f.end)
}

// ---- The compiled Vue menu bar ----------------------------------------------------------------------------------

/**
 * The fixed text of the Plugins button in a compiled bundle. Each dropdown button of the Vue bar has the class
 * "menubar-dropdown-button-dark"; the Plugins one is the only one that starts with fixed text, which Vue compiles
 * to a call with a string, such as C(" Plugins ") (minified), _createTextVNode(" Plugins ") or C(" Plugins ",-1).
 */
export function findBundleLabels(js: string): Found[] {
  const found: Found[] = []
  const call = /[(\[,]\s*"([^"\\\n]{1,80})"\s*(?:\)|,\s*-?\d+\s*(?:\/\*[^*]*\*\/\s*)?\))/
  let from = 0
  for (;;) {
    const i = js.indexOf(`${MENUBAR_MARK}"`, from)
    if (i < 0) break
    const next = js.indexOf(MENUBAR_MARK, i + MENUBAR_MARK.length)
    const end = Math.min(next < 0 ? js.length : next, i + 700)
    const m = call.exec(js.slice(i, end))
    if (m && m[1].trim()) {
      const start = i + m.index + m[0].indexOf('"') + 1
      found.push({ start, end: start + m[1].length, text: m[1].trim(), line: lineOf(js, start) })
    }
    from = i + MENUBAR_MARK.length
  }
  return found
}

export function setBundleLabel(js: string, text: string): string {
  const found = findBundleLabels(js)
  if (found.length !== 1) throw new Error(`expected one label in the bundle, found ${found.length}`)
  const f = found[0]
  const old = js.slice(f.start, f.end)
  const lead = old.match(/^\s*/)?.[0] ?? ''
  const trail = old.match(/\s*$/)?.[0] ?? ''
  return js.slice(0, f.start) + lead + text + trail + js.slice(f.end)
}

// ---- dispatcher-servlet.xml ---------------------------------------------------------------------------------------

export interface MenuName {
  /** <url>#<n>: the n-th entry with this url, stable while names change */
  id: string
  name: string
  url: string
  top: boolean
  parent: string | null
  /** Why this name must stay (code of OpenNMS looks for it); null: it can change */
  locked: string | null
  order: number
  start: number
  end: number
  line: number
}

/** Top menus that code of OpenNMS finds by their name: another name breaks a bar, so the studio keeps them. */
export const LOCKED_NAMES: Record<string, string> = {
  Search:
    'Menubar.vue finds the menu named "Search" by its name (lines 299 and 430 in 33.1.8): it leaves that menu out of the Vue bar and gives its own fixed "Search" link the url of it. Under another name the Vue bar would show a second menu, and its Search link would lead nowhere.',
}

/** The names of the menu entries (NavBarEntry beans) in dispatcher-servlet.xml, in menu order. */
export function readMenuNames(xml: string): MenuName[] {
  // Comments keep their length, so that positions stay right, but nothing inside them counts.
  const text = xml.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '))
  type Bean = { cls: string; beanName: string | null; at: number; name?: { value: string; start: number; end: number }; url?: string; parent: Bean | null }
  const stack: Bean[] = []
  const beans: Bean[] = []
  const refs = new Map<string, number>()
  const tag = /<(\/?)(bean|property|ref)\b([^>]*?)(\/?)>/g
  const attr = (s: string, a: string) => new RegExp(`\\b${a}="([^"]*)"`).exec(s)
  for (let m; (m = tag.exec(text)); ) {
    const [whole, closing, kind, attrs, selfClosing] = m
    if (kind === 'bean' && !closing) {
      const cls = attr(attrs, 'class')?.[1] ?? ''
      const nav = [...stack].reverse().find((b) => b.cls.endsWith('NavBarEntry')) ?? null
      const bean: Bean = { cls, beanName: attr(attrs, 'name')?.[1] ?? attr(attrs, 'id')?.[1] ?? null, at: m.index, parent: nav }
      if (cls.endsWith('NavBarEntry')) beans.push(bean)
      if (!selfClosing) stack.push(bean)
    } else if (kind === 'bean' && closing) stack.pop()
    else if (kind === 'ref' && !closing) {
      const name = attr(attrs, 'bean')?.[1]
      if (name && !refs.has(name)) refs.set(name, m.index)
    } else if (kind === 'property' && !closing && stack.length) {
      const owner = stack[stack.length - 1]
      const p = attr(attrs, 'name')?.[1]
      const value = /\bvalue="([^"]*)"/.exec(attrs)
      if (value && p === 'name') {
        const start = m.index + whole.indexOf(value[0]) + 'value="'.length
        owner.name = { value: value[1], start, end: start + value[1].length }
      } else if (value && p === 'url') owner.url = value[1]
    }
  }
  const counts = new Map<string, number>()
  const named = beans.filter((b) => b.name)
  const rootOf = (b: Bean): Bean => (b.parent ? rootOf(b.parent) : b)
  // A top menu that is a bean of its own (Maps, Dashboards) sits in the bar where navBarEntries refers to it.
  const placeOf = (top: Bean): number => (top.beanName && refs.has(top.beanName) ? refs.get(top.beanName)! : top.at)
  const out = named.map((b) => {
    const url = b.url ?? ''
    const n = (counts.get(url) ?? 0) + 1
    counts.set(url, n)
    const root = rootOf(b)
    const name = htmlDecode(b.name!.value)
    return {
      id: `${url}#${n}`,
      name,
      url,
      top: b.parent === null,
      parent: b.parent?.name ? htmlDecode(b.parent.name.value) : null,
      locked: b.parent === null ? (LOCKED_NAMES[name] ?? null) : null,
      order: placeOf(root) * 1000 + (b.at - root.at),
      start: b.name!.start,
      end: b.name!.end,
      line: lineOf(xml, b.name!.start),
    }
  })
  return out.sort((a, b) => a.order - b.order)
}

/** The file with new names; a locked name (LOCKED_NAMES) keeps its name. */
export function setMenuNames(xml: string, renames: Record<string, string>): string {
  const names = readMenuNames(xml).filter((n) => !n.locked && renames[n.id] !== undefined && renames[n.id] !== n.name)
  let out = xml
  for (const n of [...names].sort((a, b) => b.start - a.start)) out = out.slice(0, n.start) + htmlEncode(renames[n.id]) + out.slice(n.end)
  return out
}

/** Words of the bar that the studio does not change, and why. */
export const FIXED_LABELS = [
  {
    text: 'Search (the top menu)',
    jsp: 'dispatcher-servlet.xml, like the other menus',
    vue: 'Menubar.vue writes "Search" itself (line 17) and takes the url of the menu named "Search" for it (lines 299 and 430)',
    why: 'Under another name the Vue bar would show a second menu and its Search link would lead nowhere: the studio keeps the name.',
  },
  {
    text: 'Help, Help / About / API Documentation / Support',
    jsp: 'navbar.ftl (<a name="nav-help-top">, nav-admin-help, nav-admin-about, ...)',
    vue: 'MenuProvider.java, getHelpMenuEntry(): compiled into WEB-INF/lib/opennms-webapp-rest-*.jar',
    why: 'The Vue bar gets these words from Java code: a change needs a new build of OpenNMS (opennms-webapp-rest).',
  },
  {
    text: '<your user name>: Change Password, Log Out',
    jsp: 'navbar.ftl (nav-user-top, nav-admin-self-service, nav-admin-logout)',
    vue: 'MenuProvider.java, getSelfServiceMenuEntry()',
    why: 'Java in the Vue bar, as above.',
  },
  {
    text: 'notices assigned to you, On-Call Schedule',
    jsp: 'navbar.ftl and its JavaScript',
    vue: 'Menubar.vue ("notices assigned to you") and MenuProvider.java ("On-Call Schedule")',
    why: 'Partly compiled Vue, partly Java.',
  },
  {
    text: 'Quick-Add Node, Flow Management, Configure OpenNMS (the titles of the icons at the right)',
    jsp: 'navbar.ftl (title="...")',
    vue: 'MenuProvider.java (getProvisionMenu, getFlowsMenu, getConfigurationMenu); it says "Flows Management" where navbar.ftl says "Flow Management"',
    why: 'Java in the Vue bar. The two programs differ here already: one more reason to change words in both places or in neither.',
  },
  {
    text: 'The entries of the Plugins menu (for example "My custom plugins")',
    jsp: 'filled from /rest/plugins by the JavaScript at the end of navbar.ftl',
    vue: 'filled from /rest/plugins by Menubar.vue',
    why: 'Each plugin names its own entry (the menu entry of its UI extension): change it in the plugin.',
  },
]

// ---- What an OpenNMS has ------------------------------------------------------------------------------------------

export interface BundleState {
  file: string
  labels: string[]
  loadedByPage: boolean
}

export async function menuState(config: StudioConfig, t: Target) {
  const ftl = await t.read(NAVBAR_REL, true)
  const navbar = ftl ? findNavbarLabel(ftl.toString('utf8')) : null
  const files = await t.filesContaining(ASSETS_DIR, '*.js', MENUBAR_MARK)
  const index = await t.read(UI_INDEX_REL, true)
  const entry = index ? /assets\/([^"'\s]+\.js)/.exec(index.toString('utf8'))?.[1] ?? null : null
  const bundles: BundleState[] = []
  for (const file of files) {
    const js = await t.read(`${ASSETS_DIR}/${file}`, true)
    bundles.push({ file, labels: js ? findBundleLabels(js.toString('utf8')).map((f) => f.text) : [], loadedByPage: file === entry })
  }
  const xml = await t.read(DISPATCHER_REL, true)
  const names = xml ? readMenuNames(xml.toString('utf8')).map(({ start, end, order, ...rest }) => rest) : []
  const restPlugins = await t.http('rest/plugins', { auth: true })
  let plugins: { extensionId: string; menuEntry: string }[] | null = null
  if (restPlugins.status === 200) {
    try {
      plugins = (JSON.parse(restPlugins.body.toString('utf8')) as { extensionId: string; menuEntry: string }[]).map((p) => ({
        extensionId: p.extensionId,
        menuEntry: p.menuEntry,
      }))
    } catch {
      plugins = null
    }
  }
  return {
    target: t.name,
    where: t.where,
    plugins: {
      jsp: { file: NAVBAR_REL, found: !!navbar, text: navbar?.text ?? null, line: navbar?.line ?? null },
      vue: { dir: ASSETS_DIR, entry, bundles },
    },
    names,
    pluginEntries: plugins,
    pluginEntriesNote: plugins ? 'from /rest/plugins' : `could not ask /rest/plugins (${restPlugins.status ? `HTTP ${restPlugins.status}` : restPlugins.error})`,
    desired: readLabels(config),
    fixed: FIXED_LABELS,
  }
}

// ---- Plan and apply ---------------------------------------------------------------------------------------------

export interface MenuPlannedFile {
  rel: string
  why: string
  md5Before: string | null
  md5After: string
  diff: string
  /** For a bundle (one long line): the text around the label, before and after */
  excerpt?: { before: string; after: string }
  overlays: string[]
  overlayNote: string
  /** A file of OpenNMS itself (not yours): an overlay copy of it must go before an upgrade of OpenNMS */
  ownedByOpenNMS: boolean
}

async function changesFor(config: StudioConfig, t: Target) {
  const labels = readLabels(config)
  const changes: (FileChange & { before: Buffer; excerpt?: { before: string; after: string } })[] = []
  const problems: string[] = []
  if (labels.plugins) {
    const ftl = await t.read(NAVBAR_REL, true)
    if (!ftl) problems.push(`${NAVBAR_REL} is not there`)
    else {
      const text = ftl.toString('utf8')
      const f = findNavbarLabel(text)
      if (!f) problems.push(`${NAVBAR_REL}: no <a name="nav-plugin-top">`)
      else if (f.text !== labels.plugins) {
        changes.push({
          rel: NAVBAR_REL,
          before: ftl,
          content: Buffer.from(setNavbarLabel(text, labels.plugins)),
          why: `the JSP bar: "${f.text}" becomes "${labels.plugins}" (line ${f.line})`,
        })
      }
    }
    for (const file of await t.filesContaining(ASSETS_DIR, '*.js', MENUBAR_MARK)) {
      const rel = `${ASSETS_DIR}/${file}`
      const js = await t.read(rel, true)
      if (!js) continue
      const text = js.toString('utf8')
      const found = findBundleLabels(text)
      if (found.length !== 1) {
        problems.push(`${file}: ${found.length} labels found, expected 1: left as it is`)
        continue
      }
      if (found[0].text === labels.plugins) continue
      const after = setBundleLabel(text, labels.plugins)
      const delta = after.length - text.length
      changes.push({
        rel,
        before: js,
        content: Buffer.from(after),
        why: `the Vue bar (compiled Menubar.vue): "${found[0].text}" becomes "${labels.plugins}"`,
        excerpt: { before: excerpt(text, found[0].start, found[0].end), after: excerpt(after, found[0].start, found[0].end + delta) },
      })
    }
  }
  if (Object.keys(labels.menuNames).length) {
    const xml = await t.read(DISPATCHER_REL, true)
    if (!xml) problems.push(`${DISPATCHER_REL} is not there`)
    else {
      const text = xml.toString('utf8')
      for (const n of readMenuNames(text).filter((x) => x.locked && labels.menuNames[x.id] && labels.menuNames[x.id] !== x.name)) {
        problems.push(`"${n.name}" keeps its name: ${n.locked}`)
      }
      const after = setMenuNames(text, labels.menuNames)
      if (after !== text) {
        const renamed = readMenuNames(text).filter((n) => !n.locked && labels.menuNames[n.id] && labels.menuNames[n.id] !== n.name)
        changes.push({
          rel: DISPATCHER_REL,
          before: xml,
          content: Buffer.from(after),
          why: `menu names: ${renamed.map((n) => `"${n.name}" becomes "${labels.menuNames[n.id]}"`).join(', ')} (the Vue bar at once, the JSP bar after a restart of OpenNMS)`,
        })
      }
    }
  }
  return { changes, problems, labels }
}

export async function menuPlan(config: StudioConfig, t: Target): Promise<{ files: MenuPlannedFile[]; problems: string[] }> {
  const { changes, problems } = await changesFor(config, t)
  const files: MenuPlannedFile[] = []
  for (const c of changes) {
    const plan = await planOverlay(t, c.rel)
    files.push({
      rel: c.rel,
      why: c.why,
      md5Before: md5(c.before),
      md5After: md5(c.content),
      diff: c.excerpt ? '' : await unifiedDiff(c.before, c.content, c.rel, `${t.name} now`, 'after the apply'),
      excerpt: c.excerpt,
      overlays: plan.copies.map((x) => `${x.onHost}${x.exists ? '' : ' (new)'}`),
      overlayNote: plan.note,
      ownedByOpenNMS: true,
    })
  }
  return { files, problems }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function applyMenu(config: StudioConfig, history: History, t: Target): Promise<ApplyRecord> {
  const { changes, problems, labels } = await changesFor(config, t)
  if (changes.length === 0) throw new Error(`${t.title} has these labels already${problems.length ? ` (${problems.join('; ')})` : ''}.`)
  const commit = (await history.snapshot(`Apply the menu labels to ${t.name}`, ['menu'])) ?? (await history.head())
  return applyChanges(config, t, 'menu', changes, commit, async (): Promise<Check[]> => {
    const checks: Check[] = []
    for (const c of changes.filter((x) => x.rel.startsWith(ASSETS_DIR))) {
      const path = c.rel.replace('jetty-webapps/opennms/', '')
      const r = await t.http(path)
      checks.push(
        r.status
          ? { what: `OpenNMS serves ${path} with the new label`, ok: r.status === 200 && md5(r.body) === md5(c.content), detail: `HTTP ${r.status}` }
          : { what: `OpenNMS serves ${path}`, ok: null, detail: r.error ?? 'no answer' },
      )
    }
    const navbarChanged = changes.some((x) => x.rel === NAVBAR_REL)
    const namesChanged = changes.some((x) => x.rel === DISPATCHER_REL)
    if (navbarChanged || namesChanged) {
      // The JSP bar alone: /navBar.htm (FreeMarker reads a changed template again within about 5 seconds).
      let html = ''
      let status = 0
      for (let i = 0; i < 4; i++) {
        const r = await t.http('navBar.htm', { auth: true })
        status = r.status
        html = r.body.toString('utf8')
        if (status !== 200 || !navbarChanged || (labels.plugins && html.includes(`>${htmlEncode(labels.plugins)}</a>`))) break
        await wait(3000)
      }
      if (navbarChanged) {
        const login = t.name === 'dev' ? 'DEV_USER and DEV_PASSWORD' : 'PROD_USER and PROD_PASSWORD'
        const why =
          status === 401 || status === 403 || (status >= 300 && status < 400)
            ? `HTTP ${status}: the studio could not log in; set ${login} in kit/kit.env to let it check`
            : status === 404
              ? 'HTTP 404: this OpenNMS has no /navBar.htm'
              : status
                ? `HTTP ${status}`
                : 'no answer'
        checks.push(
          status === 200
            ? { what: 'The JSP bar (/opennms/navBar.htm) says the new Plugins label', ok: html.includes(`>${htmlEncode(labels.plugins ?? '')}</a>`), detail: 'HTTP 200' }
            : { what: 'The JSP bar (/opennms/navBar.htm)', ok: null, detail: why },
        )
      }
      if (namesChanged) {
        // The Vue bar's data: MenuRestService (package rest.v2, served at /api/v2/*) reads the file at every request.
        const menu = await t.http('api/v2/menu', { auth: true })
        const xmlBefore = changes.find((x) => x.rel === DISPATCHER_REL)!.before.toString('utf8')
        const wanted = readMenuNames(xmlBefore)
          .filter((n) => !n.locked && labels.menuNames[n.id] && labels.menuNames[n.id] !== n.name)
          .map((n) => labels.menuNames[n.id])
        const login = t.name === 'dev' ? 'DEV_USER and DEV_PASSWORD' : 'PROD_USER and PROD_PASSWORD'
        checks.push(
          menu.status === 200
            ? { what: 'The Vue bar (/opennms/api/v2/menu reads dispatcher-servlet.xml at every request) has the new names', ok: wanted.every((n) => menu.body.toString('utf8').includes(JSON.stringify(n))), detail: 'HTTP 200' }
            : {
                what: 'The Vue bar (/opennms/api/v2/menu)',
                ok: null,
                detail: menu.status === 401 || menu.status === 403 ? `HTTP ${menu.status}: set ${login} in kit/kit.env to let the studio check` : menu.status ? `HTTP ${menu.status}` : menu.error ?? 'no answer',
              },
        )
        checks.push({
          what: 'The JSP bar shows new names after the next restart of OpenNMS',
          ok: null,
          detail: status === 200 && wanted.every((n) => html.includes(htmlEncode(n))) ? 'it shows them already' : 'it read dispatcher-servlet.xml when OpenNMS started (a Spring bean)',
        })
      }
    }
    return checks
  })
}
