// Applying a change to an OpenNMS, and taking it back. Each apply:
//
//   1. keeps what it replaces: backups/<date>-<time>-<target>-<module>/container/<path> (and overlay/<folder>/<name>)
//   2. writes each file into the container            podman exec -i <container> sh -c '... cat > <path>'
//   3. on production also into its overlay folder     (the same command, with the overlay folder's path)
//   4. checks: the md5 sum of each file there equals the md5 sum of what was sent, and what the module checks
//      (for example: the web server serves the new file)
//   5. writes a line into backups/journal.jsonl
//
// Undo takes the newest apply of that target back: it writes the kept files back (or removes files the apply added).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { StudioConfig } from './config.js'
import { step } from './events.js'
import { planOverlay } from './overlay.js'
import { md5, type Target, type TargetName } from './target.js'

export interface FileChange {
  /** Path below OpenNMS's home, for example jetty-webapps/opennms/WEB-INF/templates/navbar.ftl */
  rel: string
  content: Buffer
  /** What this file is and why it changes (for the page and the record) */
  why: string
}

export interface Check {
  what: string
  /** null: could not be checked (the detail says why) */
  ok: boolean | null
  detail: string
}

export interface AppliedOverlay {
  folder: string
  name: string
  inContainer: string
  onHost: string
  existedBefore: boolean
}

export interface AppliedFile {
  rel: string
  inContainer: string
  why: string
  existedBefore: boolean
  md5Before: string | null
  md5After: string
  overlays: AppliedOverlay[]
  overlayNote: string
}

export interface ApplyRecord {
  id: string
  time: string
  target: TargetName
  module: string
  /** The snapshot (git commit) of the workspace that was applied */
  commit: string | null
  files: AppliedFile[]
  checks: Check[]
  /** Folder of the kept files, below the project folder */
  backupDir: string
  undone?: string
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function journalPath(config: StudioConfig): string {
  return join(config.backups, 'journal.jsonl')
}

/** Every apply, newest last, with undone set for the ones that were taken back. */
export function journal(config: StudioConfig): ApplyRecord[] {
  const file = journalPath(config)
  if (!existsSync(file)) return []
  const records: ApplyRecord[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const entry = JSON.parse(line) as ApplyRecord | { undo: string; time: string }
    if ('undo' in entry) {
      const r = records.find((x) => x.id === entry.undo)
      if (r) r.undone = entry.time
    } else records.push(entry)
  }
  return records
}

function keep(dir: string, sub: string, data: Buffer): void {
  const file = join(dir, sub)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
}

const folderKey = (inContainer: string, name: string) => inContainer.slice(0, inContainer.length - name.length - 1).split('/').pop() || 'overlay'

export async function applyChanges(
  config: StudioConfig,
  t: Target,
  module: string,
  changes: FileChange[],
  commit: string | null,
  moduleChecks?: () => Promise<Check[]>,
): Promise<ApplyRecord> {
  const id = `${stamp()}-${t.name}-${module}`
  const dir = join(config.backups, id)
  mkdirSync(dir, { recursive: true })
  step(t.name, `Applying ${module} to ${t.title} (${t.where}). The files it replaces go to ${relative(config.root, dir)}/.`)

  // 1. What is there now, kept for undo.
  const files: AppliedFile[] = []
  for (const c of changes) {
    const inContainer = await t.abs(c.rel)
    const before = await t.readAbs(inContainer)
    if (before) keep(dir, `container/${c.rel}`, before)
    const plan = await planOverlay(t, c.rel, { quiet: false })
    const overlays: AppliedOverlay[] = []
    for (const copy of plan.copies) {
      const old = copy.exists ? await t.readAbs(copy.inContainer) : null
      if (old) keep(dir, `overlay/${folderKey(copy.inContainer, copy.name)}/${copy.name}`, old)
      overlays.push({ folder: copy.folder.label, name: copy.name, inContainer: copy.inContainer, onHost: copy.onHost, existedBefore: !!old })
    }
    files.push({
      rel: c.rel,
      inContainer,
      why: c.why,
      existedBefore: !!before,
      md5Before: before ? md5(before) : null,
      md5After: md5(c.content),
      overlays,
      overlayNote: plan.note,
    })
  }
  const record: ApplyRecord = {
    id,
    time: new Date().toISOString(),
    target: t.name,
    module,
    commit,
    files,
    checks: [],
    backupDir: relative(config.root, dir),
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(record, null, 2))

  // 2 and 3. Write.
  for (const [i, c] of changes.entries()) {
    const f = files[i]
    if (f.md5Before === f.md5After) step(t.name, `${f.inContainer}: already this content, written again anyway`)
    step(t.name, `write ${f.inContainer} (${c.why})`)
    await t.writeAbs(f.inContainer, c.content)
    for (const o of f.overlays) {
      step(t.name, `write the overlay copy ${o.onHost} (in the container: ${o.inContainer})`)
      await t.writeAbs(o.inContainer, c.content)
    }
    if (t.name === 'prod' && f.overlays.length === 0) step(t.name, `${f.rel}: ${f.overlayNote}`, false)
  }

  // 4. Check.
  for (const f of files) {
    const now = await t.md5Abs(f.inContainer, false)
    record.checks.push({ what: `${f.inContainer} in the container`, ok: now === f.md5After, detail: `md5 ${now ?? 'missing'}` })
    for (const o of f.overlays) {
      const sum = await t.md5Abs(o.inContainer, false)
      record.checks.push({ what: `overlay copy ${o.onHost}`, ok: sum === f.md5After, detail: `md5 ${sum ?? 'missing'}` })
    }
  }
  if (moduleChecks) record.checks.push(...(await moduleChecks()))
  for (const c of record.checks) step(t.name, `${c.ok === true ? 'ok' : c.ok === false ? 'FAILED' : 'not checked'}: ${c.what} (${c.detail})`, c.ok ?? undefined)

  // 5. Record.
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(record, null, 2))
  mkdirSync(config.backups, { recursive: true })
  appendFileSync(journalPath(config), JSON.stringify(record) + '\n')
  return record
}

/** Takes back the newest apply on this OpenNMS that is not undone yet (of this module, when one is named). */
export async function undoLast(config: StudioConfig, t: Target, module?: string): Promise<{ record: ApplyRecord; checks: Check[] }> {
  const last = journal(config).filter((r) => r.target === t.name && !r.undone && (!module || r.module === module)).pop()
  if (!last) throw new Error(`There is nothing${module ? ` of the ${module} module` : ''} to undo on ${t.title}.`)
  const dir = join(config.root, last.backupDir)
  step(t.name, `Undo ${last.id}: the files of ${last.backupDir}/ go back into ${t.title}`)
  const checks: Check[] = []
  for (const f of [...last.files].reverse()) {
    const now = await t.md5Abs(f.inContainer, false)
    if (now !== f.md5After) step(t.name, `${f.inContainer} changed after that apply (md5 ${now ?? 'missing'}); it is put back anyway`, false)
    const kept = join(dir, 'container', f.rel)
    if (existsSync(kept)) await t.writeAbs(f.inContainer, readFileSync(kept))
    else await t.removeAbs(f.inContainer)
    step(t.name, existsSync(kept) ? `put back ${f.inContainer}` : `removed ${f.inContainer} (that apply added it)`)
    checks.push({ what: f.inContainer, ok: (await t.md5Abs(f.inContainer, false)) === f.md5Before, detail: f.md5Before ? `md5 ${f.md5Before} again` : 'removed' })
    for (const o of f.overlays) {
      const keptCopy = join(dir, 'overlay', folderKey(o.inContainer, o.name), o.name)
      const original = existsSync(keptCopy) ? readFileSync(keptCopy) : null
      if (original) await t.writeAbs(o.inContainer, original)
      else await t.removeAbs(o.inContainer)
      step(t.name, original ? `put back the overlay copy ${o.onHost}` : `removed the overlay copy ${o.onHost} (that apply added it)`)
      const sum = await t.md5Abs(o.inContainer, false)
      checks.push({
        what: `overlay copy ${o.onHost}`,
        ok: original ? sum === md5(original) : sum === null,
        detail: original ? `md5 ${md5(original)} again` : 'removed',
      })
    }
  }
  appendFileSync(journalPath(config), JSON.stringify({ undo: last.id, time: new Date().toISOString() }) + '\n')
  return { record: last, checks }
}
