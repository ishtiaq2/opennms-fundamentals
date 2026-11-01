// Words and rules for the topology view, made from what the preview and the icon check report. No browser code in
// here, so that server/test can run it.
import type { IconFileReport, IconInfo, IconProblem } from '../api'
import type { PartsOfGroup, RuleReach } from '../components/TopologyPreview.vue'

export interface Verdict {
  level: 'ok' | 'warn' | 'bad' | 'info'
  text: string
}

const nodes = (n: number) => `${n} node${n === 1 ? '' : 's'}`
const shapes = (n: number) => `${n} shape${n === 1 ? '' : 's'}`
const ids = (list: string[]) => list.map((g) => `#${g}`).join(', ')

/** What one selector reaches, in words. flawed(group): the icon check found a flaw in the file of that group. */
export function describeReach(r: RuleReach, flawed: (group: string) => boolean = () => false): Verdict {
  if (r.invalid) return { level: 'bad', text: 'The browser cannot use this selector.' }
  if (r.matched === 0) {
    return r.dynamic
      ? { level: 'info', text: 'Matches only while the mouse or the focus is there (or it is a pseudo-element): nothing to count now.' }
      : { level: 'bad', text: 'Matches nothing in this preview. Check the spelling of the id and of the classes (the ids of the icons are in Icon files), and that the View you preview has a node the rule is meant for.' }
  }
  if (r.shapes === 0) return { level: 'ok', text: `${r.matched} element${r.matched === 1 ? '' : 's'} of the page.` }
  const where = r.groups.length ? ` in ${ids(r.groups)}` : ''
  const page = r.matched > r.shapes ? `, and ${r.matched - r.shapes} element${r.matched - r.shapes === 1 ? '' : 's'} of the page` : ''
  const shown = [r.up ? `${nodes(r.up)} as the normal look` : '', r.over ? `${nodes(r.over)} under the mouse` : '', r.active ? `${nodes(r.active)} when selected` : '']
    .filter(Boolean)
    .join(', ')
  if (!shown) {
    return { level: 'warn', text: `${shapes(r.shapes)}${where}${page}, but no node of this view shows that drawing (its nodes have other icons).` }
  }
  if (r.hidden > 0) {
    const all = r.hidden === r.shapes
    const cover = ids(r.hiddenBy)
    const advice = r.hiddenBy.length
      ? ` The drawing on top, which covers ${all ? 'them' : 'those'}, is ${cover}: colour that one instead (click a node and choose "The parts of the icon you clicked" in the list above the editor: it writes those rules)${r.groups.some(flawed) ? ', or repair the icon file (Icon files, below): then each look is a drawing of its own' : ''}.`
      : ''
    return {
      level: 'warn',
      text: `${shapes(r.shapes)}${where}${page}; shown by ${shown}. But ${all ? 'all of them lie' : `${r.hidden} of them lie`} under a later shape with the same outline, so you ${all ? 'do not see this rule' : 'see it on the rest only'}.${advice}`,
    }
  }
  return { level: 'ok', text: `${shapes(r.shapes)}${where}${page}; shown by ${shown}.` }
}

/** The icon X as the checked files describe it (your repaired copy, when there is one, since the preview draws that). */
export function iconOf(files: IconFileReport[] | undefined, id: string): { file: IconFileReport; info: IconInfo; problems: IconProblem[]; fromCopy: boolean } | null {
  for (const file of files ?? []) {
    const view = file.copy ?? file
    const info = view.icons.find((i) => i.id === id)
    if (info) return { file, info, problems: view.problems.filter((p) => p.icon === id), fromCopy: !!file.copy }
  }
  return null
}

/** Is there an error in the file that holds this group (an id of a drawing, such as nimbus_default)? */
export function flawedGroup(files: IconFileReport[] | undefined, group: string): boolean {
  for (const file of files ?? []) {
    const view = file.copy ?? file
    for (const p of view.problems) {
      if (p.severity !== 'error') continue
      const info = view.icons.find((i) => i.id === p.icon)
      if (info && (info.id === group || info.stacked.includes(group))) return true
    }
  }
  return false
}

export interface PartsLayer {
  /** What the layer is: 'as it normally shows' and so on */
  when: string
  /** The element a node's <use> points to */
  use: string
  group: PartsOfGroup
}

/** Which groups to read the parts of: the three looks of an icon, or only the one on top when the file stacks them. */
export function layersOf(icon: string, info: IconInfo | null): { when: string; use: string; group: string }[] {
  if (info && info.stacked.some((s) => !s.endsWith('_default'))) {
    return [{ when: `the drawing a node shows (the file holds all three inside #${icon}, so the last one is on top)`, use: `use.upIcon href="#${icon}"`, group: info.visible }]
  }
  return [
    { when: 'as it normally shows', use: `use.upIcon href="#${icon}"`, group: icon },
    { when: 'under the mouse', use: `use.overIcon href="#${icon}_rollover"`, group: `${icon}_rollover` },
    { when: 'when the node is selected', use: `use.activeIcon href="#${icon}_active"`, group: `${icon}_active` },
  ]
}

/** CSS to start from: one rule for each class of each layer, with the colour the browser gives it now. */
export function partsCss(icon: string, fileName: string | null, layers: PartsLayer[], stackedNote: string | null): string {
  const out = [
    `/* The parts of the icon ${icon}${fileName ? ` (${fileName})` : ''}. Each rule colours one class of the drawing, in every node that shows it,`,
    '   with the colour the browser gives it now. Change the ones you want and delete the rest. A rule starts with the id of a drawing:',
    '   that is why it wins over the class rules of the svg files, in any order. */',
  ]
  if (stackedNote) out.push(`/* ${stackedNote} */`)
  for (const l of layers) {
    out.push('', `/* ${l.when}: ${l.use} */`)
    if (!l.group.found) {
      out.push(`/* (the page has no group #${l.group.id}: nothing to colour then) */`)
      continue
    }
    if (!l.group.parts.length) out.push(`/* (the shapes of #${l.group.id} have no class: colour them with a rule such as #${l.group.id} path { fill: #1F3A5F; }) */`)
    for (const p of l.group.parts) out.push(`#${l.group.id} .${p.cls} { fill: ${p.fill}; }   /* ${shapes(p.count)} */`)
    if (l.group.unclassed && l.group.parts.length) out.push(`/* ${shapes(l.group.unclassed)} of #${l.group.id} have no class (colour them with #${l.group.id} path { fill: ... }) */`)
  }
  return out.join('\n') + '\n'
}
