// What the topology page of OpenNMS would draw, worked out in the browser from the files of an OpenNMS:
// the GraphML views (etc/graphml/*.xml), the icon mapping files (etc/org.opennms.features.topology.app.icons.*.cfg)
// and the svg files (jetty-webapps/opennms/svg/*.svg). The rules are OpenNMS 33.1.8's (IconRepositoryManager):
//   1. a line "<namespace>.<node id> = <icon id>" in a mapping file
//   2. else the node's iconKey from the GraphML file (a GraphML view maps every iconKey to itself)
//   3. else the line "default = ..." (stock: generic)
// A node whose icon id no svg file defines is drawn without a picture: a frame and its label only.
import type { PreviewData } from '../api'

export interface GraphNode {
  id: string
  label: string
  iconKey: string
}

export interface Graph {
  file: string
  id: string
  namespace: string
  label: string
  statusProvider: string
  nodes: GraphNode[]
  edges: { source: string; target: string }[]
}

export interface DrawnNode extends GraphNode {
  key: string
  icon: string
  why: string
  defined: boolean
}

const GRAPHML_NS = 'http://graphml.graphdrawing.org/xmlns'

export function parseGraphml(file: string, text: string): Graph[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return []
  const byTag = (el: Element | Document, tag: string) => Array.from(el.getElementsByTagNameNS(GRAPHML_NS, tag).length ? el.getElementsByTagNameNS(GRAPHML_NS, tag) : el.getElementsByTagName(tag))
  const keys = new Map<string, string>()
  for (const k of byTag(doc, 'key')) keys.set(k.getAttribute('id') ?? '', k.getAttribute('attr.name') ?? k.getAttribute('id') ?? '')
  const data = (el: Element) => {
    const out: Record<string, string> = {}
    for (const d of Array.from(el.children)) if (d.localName === 'data') out[keys.get(d.getAttribute('key') ?? '') ?? ''] = (d.textContent ?? '').trim()
    return out
  }
  return byTag(doc, 'graph').map((g) => {
    const p = data(g)
    const nodes = Array.from(g.children).filter((c) => c.localName === 'node').map((n) => {
      const d = data(n)
      return { id: n.getAttribute('id') ?? '', label: d.label ?? n.getAttribute('id') ?? '', iconKey: d.iconKey ?? '' }
    })
    const edges = Array.from(g.children)
      .filter((c) => c.localName === 'edge')
      .map((e) => ({ source: e.getAttribute('source') ?? '', target: e.getAttribute('target') ?? '' }))
    return { file, id: g.getAttribute('id') ?? '', namespace: p.namespace ?? g.getAttribute('id') ?? '', label: p.label ?? g.getAttribute('id') ?? '', statusProvider: p['vertex-status-provider'] ?? 'none', nodes, edges }
  })
}

/** key -> value of a java.util.Properties text (a .cfg file): '=' ':' or blanks after the key, '\' escapes. */
export function parseProperties(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s+/, '')
    if (!line || line[0] === '#' || line[0] === '!') continue
    let key = ''
    let i = 0
    while (i < line.length && !'=: \t\f'.includes(line[i])) {
      if (line[i] === '\\' && i + 1 < line.length) i++
      key += line[i++]
    }
    let value = line.slice(i).replace(/^[ \t\f]+/, '')
    if (value[0] === '=' || value[0] === ':') value = value.slice(1)
    out.set(key, value.trim())
  }
  return out
}

const BLOCK_BEGIN = '# --- OpenNMS UI Studio: icon mappings. The studio writes the lines between these two comments. ---'
const BLOCK_END = '# --- end of the OpenNMS UI Studio icon mappings ---'
const escapeKey = (key: string) => key.replace(/\\/g, '\\\\').replace(/([:= #!])/g, '\\$1')

/** The mapping file after an apply (the same as the server's mergeMappings). */
export function mergeMappings(current: string | null, mappings: Record<string, string>): string {
  let text = current ?? ''
  const begin = text.indexOf(BLOCK_BEGIN)
  if (begin >= 0) {
    const endAt = text.indexOf(BLOCK_END, begin)
    const stop = endAt >= 0 ? text.indexOf('\n', endAt) : -1
    text = text.slice(0, begin).replace(/\n+$/, '\n') + (stop >= 0 ? text.slice(stop + 1) : '')
  }
  const keys = Object.keys(mappings).sort()
  if (!keys.length) return text
  if (text && !text.endsWith('\n')) text += '\n'
  return `${text}${text ? '\n' : ''}${BLOCK_BEGIN}\n${keys.map((k) => `${escapeKey(k)} = ${mappings[k]}`).join('\n')}\n${BLOCK_END}\n`
}

/** Every id="..." in the svg files: an icon id is any of them (OpenNMS draws <use href="#<icon id>">). */
export function definedIds(svgFiles: { text: string }[]): Set<string> {
  const ids = new Set<string>()
  for (const f of svgFiles) for (const m of f.text.matchAll(/(?<![\w:.-])id\s*=\s*(["'])(.*?)\1/g)) ids.add(m[2])
  return ids
}

/** The icons proper: the ids X of <g id="X_icon"> groups (X, X_rollover, X_active inside). */
export function iconIds(svgFiles: { text: string }[]): string[] {
  const ids = new Set<string>()
  for (const f of svgFiles) for (const m of f.text.matchAll(/id="([^"]+)_icon"/g)) ids.add(m[1])
  return [...ids].sort()
}

export function mappingTable(data: PreviewData, pending: Record<string, string>): Map<string, { icon: string; file: string }> {
  const table = new Map<string, { icon: string; file: string }>()
  const files = [...data.mappingFiles].sort((a, b) => a.file.localeCompare(b.file))
  const defaultFile = 'org.opennms.features.topology.app.icons.default.cfg'
  if (!files.some((f) => f.file === defaultFile)) files.push({ file: defaultFile, text: '' })
  for (const f of files) {
    const text = f.file === defaultFile ? mergeMappings(f.text, pending) : f.text
    for (const [k, v] of parseProperties(text)) if (!table.has(k)) table.set(k, { icon: v, file: f.file })
  }
  return table
}

export function drawnNodes(graph: Graph, table: Map<string, { icon: string; file: string }>, defined: Set<string>): DrawnNode[] {
  return graph.nodes.map((n) => {
    const key = `${graph.namespace}.${n.id}`
    let icon: string
    let why: string
    const line = table.get(key)
    if (line) {
      icon = line.icon
      why = `the line ${escapeKey(key)} in ${line.file}`
    } else if (n.iconKey) {
      icon = n.iconKey
      why = 'its iconKey in the GraphML file'
    } else {
      icon = table.get('default')?.icon ?? 'generic'
      why = 'the default icon (no line, no iconKey)'
    }
    return { ...n, key, icon, why, defined: defined.has(icon) }
  })
}

/** A small view for an OpenNMS without GraphML views: one node per icon. */
export function demoGraph(icons: string[]): Graph {
  const chosen = icons.slice(0, 8)
  return {
    file: '(demo)',
    id: 'demo',
    namespace: 'demo',
    label: 'Demo: one node per icon',
    statusProvider: 'default',
    nodes: chosen.map((icon, i) => ({ id: String(i + 1), label: icon, iconKey: icon })),
    edges: chosen.slice(1).map((_, i) => ({ source: '1', target: String(i + 2) })),
  }
}
