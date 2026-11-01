// Looks into the svg icon files of OpenNMS (jetty-webapps/opennms/svg/*.svg) and says whether OpenNMS can draw
// them as their maker meant, and how to repair the most common flaw.
//
// What OpenNMS needs (IconRepositoryManager, GWTVertex; the stock files do it this way):
//
//   <g id="X_icon">                 a wrapper: only a name for the three drawings together
//     <g id="X">          ...</g>   the normal look.           A node is drawn with <use href="#X">
//     <g id="X_rollover"> ...</g>   the look under the mouse.   <use class="overIcon" href="#X_rollover">
//     <g id="X_active">   ...</g>   the look when selected.     <use class="activeIcon" href="#X_active">
//   </g>
//
// <use href="#X"> draws EVERYTHING inside the element with id X. So the three drawings must be separate groups. A file
// whose #X holds #X_rollover and #X_active draws all three, one over the other, as the normal look: the last one in
// the file (X_active) is on top and hides the rest. A CSS rule for a group that is covered changes nothing you see,
// and OpenNMS never draws a group called X_default.
//
// No XML library: a small scanner finds the tags, the nesting and the place of each id="..." in the text, so that a
// repair changes those places and nothing else (the rest of the file stays byte for byte).

export interface IconFix {
  summary: string
  /** Id renames, applied together: the group that has the id `from` gets the id `to` */
  renames: { from: string; to: string }[]
}

export type ProblemKind = 'stacked' | 'default-group' | 'no-normal' | 'missing-state' | 'unused-default' | 'no-drawing'

export interface IconProblem {
  kind: ProblemKind
  /** error: OpenNMS draws something else than the file means; note: it works, but is worth knowing */
  severity: 'error' | 'note'
  /** The icon id X the problem is about ('' for the whole file) */
  icon: string
  message: string
  fix: IconFix | null
  /** Why no automatic repair exists, when it does not */
  noFix?: string
}

export interface IconInfo {
  id: string
  hasNormal: boolean
  hasRollover: boolean
  hasActive: boolean
  hasWrapper: boolean
  /** Ids of the state groups that lie inside #id (so that a node draws them all) */
  stacked: string[]
  /** The id of the group a node drawn with this icon shows on top: the icon itself, or the last drawing inside it */
  visible: string
}

export interface IconFileCheck {
  name: string
  /** One of OpenNMS's own files: not checked, they have quirks of their own */
  stock: boolean
  hasStyle: boolean
  icons: IconInfo[]
  problems: IconProblem[]
}

export const STOCK_ICON_FILES = new Set(['opennms_icons.svg', 'atlas_icons.svg', 'vmware_icons.svg', 'legacy_icons.svg'])

/** The style file of the studio itself and of the topology kit: never an icon file of the workspace. */
export const RESERVED_ICON_NAME = /^zz-topology-styles/

export function validIconFileName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.svg$/.test(name) && !RESERVED_ICON_NAME.test(name)
}

// ---- The scanner ----------------------------------------------------------------------------------------------------

interface El {
  tag: string
  id: string | null
  /** Where the text of the id value starts and ends in the file */
  idAt: [number, number] | null
  parent: number
  children: number[]
}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>[]|\[[\s\S]*?\])*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
const ATTRIBUTE = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

function scan(text: string): El[] {
  const els: El[] = [{ tag: '#root', id: null, idAt: null, parent: -1, children: [] }]
  const open: number[] = [0]
  for (const m of text.matchAll(TOKEN)) {
    if (m[2] === undefined) continue // a comment, CDATA, a processing instruction or the doctype
    if (m[1] === '/') {
      for (let i = open.length - 1; i > 0; i--) {
        if (els[open[i]].tag === m[2]) {
          open.length = i
          break
        }
      }
      continue
    }
    const attrsAt = (m.index ?? 0) + 1 + m[2].length
    let id: string | null = null
    let idAt: [number, number] | null = null
    for (const a of m[3].matchAll(ATTRIBUTE)) {
      if (a[1] !== 'id') continue
      const value = a[2] ?? a[3] ?? ''
      const end = attrsAt + (a.index ?? 0) + a[0].length - 1
      id = value
      idAt = [end - value.length, end]
      break
    }
    const parent = open[open.length - 1]
    const at = els.length
    els.push({ tag: m[2], id, idAt, parent, children: [] })
    els[parent].children.push(at)
    if (m[4] !== '/') open.push(at)
  }
  return els
}

function within(els: El[], inner: number, outer: number): boolean {
  for (let p = els[inner].parent; p >= 0; p = els[p].parent) if (p === outer) return true
  return false
}

function mention(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`#${escaped}(?![\\w-])`).test(text)
}

// ---- The check --------------------------------------------------------------------------------------------------------

export function checkIconFile(name: string, text: string): IconFileCheck {
  const stock = STOCK_ICON_FILES.has(name)
  const els = scan(text)
  const hasStyle = els.some((e) => e.tag === 'style')
  const out: IconFileCheck = { name, stock, hasStyle, icons: [], problems: [] }
  const byId = new Map<string, number>()
  els.forEach((e, i) => {
    if (e.id && !byId.has(e.id)) byId.set(e.id, i)
  })
  if (stock) return out

  const bases = new Set<string>()
  for (const id of byId.keys()) {
    const m = /^(.+)_(rollover|active|default|icon)$/.exec(id)
    if (m) bases.add(m[1])
  }
  // A group whose id has no state siblings is an icon too, when it is not a part of another one.
  for (const [id, i] of byId) {
    if (els[i].tag === 'g' && els[els[i].parent]?.tag === 'svg' && !/_(rollover|active|default|icon)$/.test(id)) bases.add(id)
  }

  for (const x of [...bases].sort()) {
    const at = (suffix: string) => byId.get(x + suffix)
    const normal = byId.get(x)
    const roll = at('_rollover')
    const act = at('_active')
    const def = at('_default')
    const wrap = at('_icon')
    const insideX = (n: number | undefined): n is number => n !== undefined && normal !== undefined && within(els, n, normal)
    const candidates: [string, number | undefined][] = [
      ['_default', def],
      ['_rollover', roll],
      ['_active', act],
    ]
    // The drawings that lie inside #X, in the order of the file: a later one is drawn over an earlier one.
    const inside = candidates.filter((c): c is [string, number] => insideX(c[1])).sort((a, b) => a[1] - b[1])
    const stackedIds = inside.map(([s]) => x + s)
    const info: IconInfo = {
      id: x,
      hasNormal: normal !== undefined && normal !== def,
      hasRollover: roll !== undefined,
      hasActive: act !== undefined,
      hasWrapper: wrap !== undefined,
      stacked: stackedIds,
      visible: x,
    }
    const states = stackedIds.filter((s) => !s.endsWith('_default'))
    if (states.length) info.visible = stackedIds[stackedIds.length - 1]
    // Only groups that can be drawn are icons: skip a lone group with no states at all that is just a wrapper.
    if (normal === undefined && def === undefined && roll === undefined && act === undefined) continue
    out.icons.push(info)

    if (states.length) {
      const rest = states.map((s) => `#${s}`).join(' and ')
      const problem: IconProblem = {
        kind: 'stacked',
        severity: 'error',
        icon: x,
        message:
          `#${x} holds ${stackedIds.map((s) => `#${s}`).join(', ')}. A node is drawn with <use href="#${x}">, which draws everything inside #${x}: ` +
          `the ${stackedIds.length} drawings lie one over the other, and the last one in the file, #${info.visible}, is on top and hides the others. ` +
          `So a node shows the look of #${info.visible}, and a CSS rule for ${stackedIds.filter((s) => s !== info.visible).map((s) => `#${s}`).join(' or ') || 'another layer'} changes a layer nobody sees. ` +
          `OpenNMS wants ${rest} next to #${x}, not inside it.`,
        fix: null,
      }
      const defIsChild = def !== undefined && normal !== undefined && els[def].parent === normal && els[def].tag === 'g' && els[normal].tag === 'g'
      if (defIsChild && wrap === undefined && !mention(text, x) && !mention(text, `${x}_default`) && !mention(text, `${x}_icon`)) {
        problem.fix = {
          summary: `rename the group #${x} to #${x}_icon (it only holds the three drawings), and the group #${x}_default to #${x} (the normal look)`,
          renames: [
            { from: x, to: `${x}_icon` },
            { from: `${x}_default`, to: x },
          ],
        }
      } else if (def === undefined) {
        problem.noFix = `#${x} has no group #${x}_default for the normal look: move #${states.join(' and #')} out of #${x} by hand.`
      } else if (wrap !== undefined) {
        problem.noFix = `The file has a group #${x}_icon already.`
      } else if (!defIsChild) {
        problem.noFix = `#${x}_default is not a direct child group of #${x}.`
      } else {
        problem.noFix = `The file refers to #${x}, #${x}_default or #${x}_icon itself (a style rule or a reference): renaming them would change that.`
      }
      out.problems.push(problem)
      continue
    }

    if (normal === undefined && def !== undefined) {
      const problem: IconProblem = {
        kind: 'default-group',
        severity: 'error',
        icon: x,
        message: `The file has #${x}_default but no #${x}. A node is drawn with <use href="#${x}">; OpenNMS never draws a group called ${x}_default, so a node with the icon ${x} shows nothing of this file.`,
        fix: null,
      }
      if (els[def].tag === 'g' && !mention(text, `${x}_default`) && !mention(text, x)) {
        problem.fix = { summary: `rename the group #${x}_default to #${x}`, renames: [{ from: `${x}_default`, to: x }] }
      } else {
        problem.noFix = `The file refers to #${x}_default or #${x} itself: renaming would change that.`
      }
      out.problems.push(problem)
      continue
    }

    if (normal === undefined && wrap !== undefined) {
      out.problems.push({
        kind: 'no-normal',
        severity: 'error',
        icon: x,
        message: `The file has #${x}_icon but no group #${x} for the normal look, so a node with the icon ${x} shows nothing of this file.`,
        fix: null,
        noFix: `Name the group of the normal look #${x}.`,
      })
      continue
    }

    if (def !== undefined && normal !== undefined) {
      out.problems.push({
        kind: 'unused-default',
        severity: 'note',
        icon: x,
        message: `#${x}_default is not drawn: OpenNMS draws #${x}. Only #${x} counts.`,
        fix: null,
      })
    }
    if (normal !== undefined && (roll === undefined || act === undefined)) {
      const missing = [roll === undefined ? `#${x}_rollover (under the mouse)` : '', act === undefined ? `#${x}_active (selected)` : ''].filter(Boolean).join(' and ')
      out.problems.push({
        kind: 'missing-state',
        severity: 'note',
        icon: x,
        message: `The file has no ${missing}: that look is not drawn, the node keeps the normal look then.`,
        fix: null,
      })
    }
  }

  if (!out.icons.length && !hasStyle) {
    out.problems.push({
      kind: 'no-drawing',
      severity: 'note',
      icon: '',
      message: 'The file has no group with an id and no <style>: OpenNMS can draw no icon from it.',
      fix: null,
    })
  }
  return out
}

// ---- The repair -------------------------------------------------------------------------------------------------------

/** The text with the renames done, and nothing else changed. Throws when the file does not have what the fix expects. */
export function applyIconFix(text: string, fix: IconFix): string {
  const els = scan(text)
  const edits: { at: [number, number]; to: string }[] = []
  for (const r of fix.renames) {
    const found = els.filter((e) => e.id === r.from && e.idAt)
    if (found.length !== 1) throw new Error(`The file has ${found.length} elements with the id ${r.from}; the repair expects one.`)
    edits.push({ at: found[0].idAt as [number, number], to: r.to })
  }
  edits.sort((a, b) => b.at[0] - a.at[0])
  let out = text
  for (const e of edits) out = out.slice(0, e.at[0]) + e.to + out.slice(e.at[1])
  return out
}

/** Repairs everything the check can repair. applied: what was done. Nothing to repair: the text comes back as it is. */
export function repairIconFile(name: string, text: string): { text: string; applied: IconFix[]; left: IconProblem[] } {
  const applied: IconFix[] = []
  let current = text
  for (let round = 0; round < 20; round++) {
    const next = checkIconFile(name, current).problems.find((p) => p.severity === 'error' && p.fix)
    if (!next?.fix) break
    const repaired = applyIconFix(current, next.fix)
    // The repair must remove the problem it was made for, or it is not a repair.
    const again = checkIconFile(name, repaired).problems.find((p) => p.icon === next.icon && p.severity === 'error')
    if (again) throw new Error(`The repair for ${name} (${next.fix.summary}) did not give the expected structure; the file is left alone.`)
    applied.push(next.fix)
    current = repaired
  }
  return { text: current, applied, left: checkIconFile(name, current).problems.filter((p) => p.severity === 'error') }
}
