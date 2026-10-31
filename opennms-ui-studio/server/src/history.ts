// Tracking your changes: the folder workspace/ is a git repository. The studio runs plain git commands in it, and
// the command log shows each one, so the same steps work by hand in a terminal:
//
//   snapshot             git add -A && git commit -m "<your message>"
//   what changed         git diff HEAD            (since the last snapshot)
//   history              git log
//   new experiment       git switch -c experiment/<name>     (your current changes go with you)
//   switch experiment    git switch <branch>
//   take a file back     git restore --source=<snapshot> -- <file>
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { StudioConfig } from './config.js'
import { emit } from './events.js'
import { run, shellLine } from './run.js'

export interface Snapshot {
  hash: string
  short: string
  date: string
  refs: string
  message: string
}

export interface Branch {
  name: string
  short: string
  date: string
  message: string
  current: boolean
}

export class History {
  private identity: string[] = []

  constructor(private readonly config: StudioConfig) {}

  private async git(args: string[], opts: { quiet?: boolean; allowFail?: boolean } = {}) {
    const r = await run('git', ['-C', this.config.workspace, ...this.identity, ...args], {
      target: 'workspace',
      quiet: opts.quiet,
      display: `git ${shellLine(args)}    (in workspace/)`,
    })
    if (r.code !== 0 && !opts.allowFail) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim() || r.stdout.toString().trim()}`)
    return r
  }

  /** Creates the repository with its first files, once. */
  async init(initialFiles: Record<string, string>): Promise<void> {
    const name = (await run('git', ['config', '--get', 'user.name'], { quiet: true })).stdout.toString().trim()
    this.identity = name ? [] : ['-c', 'user.name=OpenNMS UI Studio', '-c', 'user.email=studio@localhost']
    const fresh = !existsSync(join(this.config.workspace, '.git'))
    mkdirSync(this.config.workspace, { recursive: true })
    let added = false
    for (const [rel, text] of Object.entries(initialFiles)) {
      const file = join(this.config.workspace, rel)
      if (!existsSync(file)) {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, text)
        added = true
      }
    }
    if (fresh) {
      await this.git(['init', '-q'])
      await this.git(['checkout', '-q', '-b', 'main'], { allowFail: true })
    }
    if (fresh || added) {
      await this.git(['add', '-A'])
      await this.git(['commit', '-q', '-m', fresh ? 'Start: the studio’s workspace' : 'New files of the studio'], { allowFail: true })
    }
  }

  async head(): Promise<string | null> {
    const r = await this.git(['rev-parse', '--short', 'HEAD'], { quiet: true, allowFail: true })
    return r.code === 0 ? r.stdout.toString().trim() : null
  }

  async branch(): Promise<string> {
    return (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], { quiet: true })).stdout.toString().trim()
  }

  /** Files changed since the last snapshot: [{status, path}] (git status --porcelain). */
  async status(): Promise<{ status: string; path: string }[]> {
    const r = await this.git(['status', '--porcelain=v1', '-uall'], { quiet: true })
    return r.stdout
      .toString()
      .split('\n')
      .filter(Boolean)
      .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) }))
  }

  async diff(from?: string, to?: string, paths: string[] = []): Promise<string> {
    const args = ['diff', '--no-color']
    if (from) args.push(from)
    else args.push('HEAD')
    if (to) args.push(to)
    const r = await this.git([...args, '--', ...paths], { quiet: true })
    return r.stdout.toString()
  }

  async log(limit = 100): Promise<Snapshot[]> {
    const r = await this.git(['log', `-n${limit}`, '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%ad%x1f%D%x1f%s'], { quiet: true, allowFail: true })
    return r.stdout
      .toString()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, short, date, refs, message] = l.split('\x1f')
        return { hash, short, date, refs, message }
      })
  }

  /** git add -A and git commit; null when nothing changed. */
  async snapshot(message: string, paths: string[] = []): Promise<string | null> {
    await this.git(['add', '-A', '--', ...(paths.length ? paths : ['.'])])
    const staged = await this.git(['diff', '--cached', '--quiet'], { quiet: true, allowFail: true })
    if (staged.code === 0) return null
    await this.git(['commit', '-q', '-m', message.trim() || 'Snapshot'])
    emit({ type: 'changed', what: 'history' })
    return this.head()
  }

  async branches(): Promise<Branch[]> {
    const current = await this.branch()
    const r = await this.git(
      ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%1f%(objectname:short)%1f%(committerdate:iso-strict)%1f%(subject)', 'refs/heads'],
      { quiet: true },
    )
    return r.stdout
      .toString()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name, short, date, message] = l.split('\x1f')
        return { name, short, date, message, current: name === current }
      })
  }

  /** git switch -c experiment/<name>: a new line of snapshots; the current changes come along. */
  async newExperiment(name: string): Promise<string> {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug) throw new Error('Give the experiment a name (letters, digits, - and _).')
    const branch = `experiment/${slug}`
    await this.git(['switch', '-q', '-c', branch])
    emit({ type: 'changed', what: 'workspace' })
    return branch
  }

  async switchTo(branch: string): Promise<void> {
    if ((await this.status()).length) {
      throw new Error('There are changes since the last snapshot. Make a snapshot first, so that they stay with this experiment.')
    }
    await this.git(['switch', '-q', branch])
    emit({ type: 'changed', what: 'workspace' })
  }

  /** The files of a snapshot back into the workspace, as changes since the last snapshot. */
  async restore(commit: string, paths: string[]): Promise<void> {
    await this.git(['restore', `--source=${commit}`, '--worktree', '--', ...(paths.length ? paths : ['.'])])
    emit({ type: 'changed', what: 'workspace' })
  }

  async show(commit: string, path: string): Promise<string | null> {
    const r = await this.git(['show', `${commit}:${path}`], { quiet: true, allowFail: true })
    return r.code === 0 ? r.stdout.toString() : null
  }
}
