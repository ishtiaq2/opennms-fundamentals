// The studio's server API, typed. Every call is a plain fetch to /api/...: the browser's DevTools (F12 > Network)
// show each one with its answer.

export type TargetName = 'dev' | 'prod'

export interface Status {
  version: string
  workspace: { path: string; branch: string; head: string | null; changes: number }
  dev: { container: string; url: string; port: number; running: boolean }
  prod: { ssh: string; container: string; url: string; reachable: boolean; message: string; running: boolean }
  busy: string | null
}

export interface TopologySummary {
  cssPath: string
  css: string
  mappings: Record<string, string>
  hasRules: boolean
  mark: string | null
  generated: { rel: string; md5: string; size: number; text: string }
}

export interface PreviewData {
  target: TargetName
  svgFiles: { name: string; text: string }[]
  views: { file: string; text: string }[]
  viewConfigs: { file: string; text: string }[]
  mappingFiles: { file: string; text: string }[]
  stockCss: string
  stockCssFrom: string
  styleFileThere: string | null
}

export interface TopologyState {
  target: TargetName
  where: string
  style: {
    rel: string
    expected: string
    inContainer: string | null
    same: boolean
    served: { status: number; same: boolean; cacheControl: string | null; error?: string }
    overlays: { onHost: string; md5: string | null }[]
    overlayNote: string
  }
  mappings: { rel: string; upToDate: boolean }
}

export interface PlannedFile {
  rel: string
  why: string
  md5Before: string | null
  md5After: string
  same?: boolean
  diff: string
  excerpt?: { before: string; after: string }
  overlays: string[]
  overlayNote: string
  ownedByOpenNMS?: boolean
}

export interface MenuName {
  id: string
  name: string
  url: string
  top: boolean
  parent: string | null
  /** Why this name must stay (OpenNMS code looks for it); null: it can change */
  locked: string | null
  line: number
}

export interface Labels {
  plugins: string | null
  menuNames: Record<string, string>
}

export interface MenuState {
  target: TargetName
  where: string
  plugins: {
    jsp: { file: string; found: boolean; text: string | null; line: number | null }
    vue: { dir: string; entry: string | null; bundles: { file: string; labels: string[]; loadedByPage: boolean }[] }
  }
  names: MenuName[]
  pluginEntries: { extensionId: string; menuEntry: string }[] | null
  pluginEntriesNote: string
  desired: Labels
  fixed: { text: string; jsp: string; vue: string; why: string }[]
}

export interface Check {
  what: string
  ok: boolean | null
  detail: string
}

export interface ApplyRecord {
  id: string
  time: string
  target: TargetName
  module: string
  commit: string | null
  files: {
    rel: string
    inContainer: string
    why: string
    existedBefore: boolean
    md5Before: string | null
    md5After: string
    overlays: { folder: string; name: string; inContainer: string; onHost: string; existedBefore: boolean }[]
    overlayNote: string
  }[]
  checks: Check[]
  backupDir: string
  undone?: string
}

export interface HistoryInfo {
  branch: string
  head: string | null
  changes: { status: string; path: string }[]
  diff: string
  log: { hash: string; short: string; date: string; refs: string; message: string }[]
  branches: { name: string; short: string; date: string; message: string; current: boolean }[]
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `${method} ${path}: HTTP ${res.status}`)
  return data
}

export const api = {
  status: () => call<Status>('GET', '/status'),

  topology: () => call<TopologySummary>('GET', '/topology'),
  saveCss: (css: string) => call<TopologySummary>('PUT', '/topology/css', { css }),
  saveMappings: (mappings: Record<string, string>) => call<TopologySummary>('PUT', '/topology/mappings', { mappings }),
  importCss: (path: string) => call<TopologySummary>('POST', '/topology/import', { path }),
  preview: (target: TargetName, refresh = false) => call<PreviewData>('GET', `/topology/preview?target=${target}${refresh ? '&refresh=1' : ''}`),
  topologyState: (target: TargetName) => call<TopologyState>('GET', `/topology/state?target=${target}`),
  topologyPlan: (target: TargetName) => call<PlannedFile[]>('GET', `/topology/plan?target=${target}`),
  applyTopology: (target: TargetName) => call<ApplyRecord>('POST', '/topology/apply', { target, confirm: target === 'prod' ? 'production' : undefined }),

  menuState: (target: TargetName) => call<MenuState>('GET', `/menu/state?target=${target}`),
  saveLabels: (labels: Partial<Labels>) => call<Labels>('PUT', '/menu/labels', labels),
  menuPlan: (target: TargetName) => call<{ files: PlannedFile[]; problems: string[] }>('GET', `/menu/plan?target=${target}`),
  applyMenu: (target: TargetName) => call<ApplyRecord>('POST', '/menu/apply', { target, confirm: target === 'prod' ? 'production' : undefined }),
  restartDev: () => call<{ ok: boolean; seconds?: number }>('POST', '/dev/restart'),

  history: () => call<HistoryInfo>('GET', '/history'),
  diff: (from?: string, to?: string, path?: string) =>
    call<{ diff: string }>('GET', `/history/diff?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(path ? { path } : {}) })}`),
  snapshot: (message: string) => call<{ commit: string | null }>('POST', '/history/snapshot', { message }),
  newExperiment: (name: string) => call<{ branch: string }>('POST', '/history/experiment', { name }),
  switchBranch: (branch: string) => call<{ branch: string }>('POST', '/history/switch', { branch }),
  restore: (commit: string, paths: string[] = []) => call<{ ok: boolean }>('POST', '/history/restore', { commit, paths }),

  deploys: () => call<ApplyRecord[]>('GET', '/deploys'),
  undo: (target: TargetName, module?: 'topology' | 'menu') =>
    call<{ record: ApplyRecord; checks: Check[] }>('POST', '/deploys/undo', { target, module, confirm: target === 'prod' ? 'production' : undefined }),
}
