// A target is one OpenNMS: "dev" (the development container on this machine) or "prod" (the production container,
// reached over ssh). Everything the studio does to OpenNMS goes through the few commands below, so that a student
// can repeat each of them by hand:
//
//   read a file    podman exec <container> cat <path>
//   write a file   podman exec -i <container> sh -c 'mkdir -p "$(dirname "$1")" && cat > "$1"' sh <path>   (file on stdin)
//   check sums     podman exec <container> md5sum <path>
//   overlays       podman container inspect --format '{{json .Mounts}}' <container>
//
// For production each of them runs as: ssh <user@host> podman ...
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { StudioConfig, TargetSettings } from './config.js'
import { run, shellLine, type RunResult } from './run.js'
import { readTar } from './util/archive.js'

export type TargetName = 'dev' | 'prod'

export interface Mount {
  Type: string
  Source: string
  Destination: string
  Name?: string
}

export interface HttpAnswer {
  ok: boolean
  status: number
  headers: Record<string, string>
  body: Buffer
  error?: string
}

export function md5(data: Buffer | string): string {
  return createHash('md5').update(data).digest('hex')
}

export class Target {
  readonly settings: TargetSettings
  private homeCache?: string
  private mountsCache?: { at: number; mounts: Mount[] }

  constructor(
    readonly name: TargetName,
    private readonly config: StudioConfig,
  ) {
    this.settings = name === 'dev' ? config.dev : config.prod
  }

  get container(): string {
    return this.settings.container
  }

  /** "container onms-dev-core on this machine" / "container opennms on maven-admin@192.168.0.36" */
  get where(): string {
    return this.name === 'dev'
      ? `container ${this.container} on this machine`
      : `container ${this.container} on ${this.config.prodSsh}`
  }

  get title(): string {
    return this.name === 'dev' ? 'the development OpenNMS' : 'production'
  }

  /** podman with these arguments, on the machine of this target. */
  podman(args: string[], opts: { input?: Buffer | string; quiet?: boolean; timeoutMs?: number } = {}): Promise<RunResult> {
    if (this.name === 'dev') {
      const [cmd, ...before] = this.config.podman
      return run(cmd, [...before, ...args], { ...opts, target: 'dev' })
    }
    const sshDir = join(homedir(), '.ssh')
    mkdirSync(sshDir, { recursive: true, mode: 0o700 })
    const options = [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${join(sshDir, 'cm-%C')}`,
      '-o', 'ControlPersist=120',
    ]
    const remote = shellLine(['podman', ...args])
    return run('ssh', [...options, this.config.prodSsh, remote], {
      ...opts,
      target: 'prod',
      display: `ssh ${this.config.prodSsh} ${remote}`,
    })
  }

  /** podman exec in the container (with -i when there is input). */
  exec(args: string[], opts: { input?: Buffer | string; quiet?: boolean; timeoutMs?: number } = {}): Promise<RunResult> {
    const interactive = opts.input !== undefined ? ['-i'] : []
    return this.podman(['exec', ...interactive, this.container, ...args], opts)
  }

  async running(): Promise<boolean> {
    const r = await this.podman(['container', 'inspect', '-f', '{{.State.Running}}', this.container], { quiet: true, timeoutMs: 20000 })
    return r.code === 0 && r.stdout.toString().trim() === 'true'
  }

  /** Can the studio log in to production (ssh with a key) and is podman there? For dev: is podman here? */
  async reachable(): Promise<{ ok: boolean; message: string }> {
    const r = await this.podman(['--version'], { quiet: true, timeoutMs: 20000 })
    if (r.code === 0) return { ok: true, message: r.stdout.toString().trim() }
    if (this.name === 'prod') {
      return {
        ok: false,
        message: `Cannot log in to ${this.config.prodSsh} without a password (ssh-copy-id ${this.config.prodSsh} once): ${r.stderr.trim()}`,
      }
    }
    return { ok: false, message: `podman does not run here: ${r.stderr.trim()}` }
  }

  /** OpenNMS's home in the container, as a real path: /usr/share/opennms in the image (/opt/opennms links to it). */
  async home(): Promise<string> {
    if (this.homeCache) return this.homeCache
    const r = await this.exec(['readlink', '-f', '/opt/opennms'], { quiet: true })
    const home = r.code === 0 ? r.stdout.toString().trim() : ''
    if (!home) return '/opt/opennms'
    this.homeCache = home
    return home
  }

  async abs(rel: string): Promise<string> {
    return `${await this.home()}/${rel}`
  }

  async readAbs(path: string, quiet = false): Promise<Buffer | null> {
    const r = await this.exec(['cat', path], { quiet })
    return r.code === 0 ? r.stdout : null
  }

  async read(rel: string, quiet = false): Promise<Buffer | null> {
    return this.readAbs(await this.abs(rel), quiet)
  }

  async writeAbs(path: string, data: Buffer): Promise<void> {
    const r = await this.exec(['sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', path], { input: data })
    if (r.code !== 0) throw new Error(`Could not write ${path} in the ${this.where}: ${r.stderr.trim()}`)
  }

  async write(rel: string, data: Buffer): Promise<void> {
    await this.writeAbs(await this.abs(rel), data)
  }

  async removeAbs(path: string): Promise<void> {
    const r = await this.exec(['rm', '-f', path])
    if (r.code !== 0) throw new Error(`Could not remove ${path} in the ${this.where}: ${r.stderr.trim()}`)
  }

  /** test -e. Quiet (not in the command log) unless an apply or undo asks: the pages ask it often. */
  async existsAbs(path: string, quiet = true): Promise<boolean> {
    return (await this.exec(['test', '-e', path], { quiet })).code === 0
  }

  /** md5sum. Quiet unless an apply or undo asks, as above. */
  async md5Abs(path: string, quiet = true): Promise<string | null> {
    const r = await this.exec(['md5sum', path], { quiet })
    return r.code === 0 ? r.stdout.toString().slice(0, 32) : null
  }

  /** Names of the files in a folder below OpenNMS's home that contain this text (grep -l -F). */
  async filesContaining(relDir: string, glob: string, text: string): Promise<string[]> {
    const dir = await this.abs(relDir)
    const r = await this.exec(['sh', '-c', `cd "$1" 2>/dev/null && grep -l -F -e "$2" -- ${glob} 2>/dev/null; true`, 'sh', dir, text])
    return r.stdout.toString().split('\n').map((s) => s.trim()).filter(Boolean).sort()
  }

  /** Several files below a folder in one go (tar): patterns such as 'graphml/*.xml' or '*.svg'. */
  async readMany(relDir: string, patterns: string[]): Promise<Map<string, Buffer>> {
    const dir = await this.abs(relDir)
    const script =
      'cd "$1" 2>/dev/null || exit 0; shift; set -- $(for p in "$@"; do for f in $p; do [ -f "$f" ] && echo "$f"; done; done); ' +
      '[ $# -gt 0 ] && tar -cf - "$@"; true'
    const r = await this.exec(['sh', '-c', script, 'sh', dir, ...patterns])
    return readTar(r.stdout)
  }

  /** The folders and volumes mounted into the container. */
  async mounts(): Promise<Mount[]> {
    if (this.mountsCache && Date.now() - this.mountsCache.at < 60000) return this.mountsCache.mounts
    const r = await this.podman(['container', 'inspect', '--format', '{{json .Mounts}}', this.container])
    if (r.code !== 0) throw new Error(`Could not inspect the ${this.where}: ${r.stderr.trim()}`)
    const mounts = JSON.parse(r.stdout.toString() || '[]') as Mount[]
    this.mountsCache = { at: Date.now(), mounts }
    return mounts
  }

  /** podman restart (only for dev: the studio never restarts production). */
  async restart(): Promise<RunResult> {
    if (this.name !== 'dev') throw new Error('The studio restarts the development OpenNMS only.')
    this.homeCache = undefined
    this.mountsCache = undefined
    return this.podman(['restart', this.container], { timeoutMs: 180000 })
  }

  /** Asks OpenNMS's web server for a path below /opennms, from this machine (the way a browser asks). */
  async http(path: string, opts: { auth?: boolean } = {}): Promise<HttpAnswer> {
    const url = `${this.settings.url.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
    const headers: Record<string, string> = { 'Cache-Control': 'no-cache' }
    if (opts.auth && this.settings.user) {
      headers.Authorization = `Basic ${Buffer.from(`${this.settings.user}:${this.settings.password}`).toString('base64')}`
    }
    try {
      const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(10000) })
      const body = Buffer.from(await res.arrayBuffer())
      const out: Record<string, string> = {}
      res.headers.forEach((v, k) => (out[k] = v))
      return { ok: res.status === 200, status: res.status, headers: out, body }
    } catch (e) {
      return { ok: false, status: 0, headers: {}, body: Buffer.alloc(0), error: `${url}: ${(e as Error).message}` }
    }
  }
}

export function targets(config: StudioConfig): Record<TargetName, Target> {
  return { dev: new Target('dev', config), prod: new Target('prod', config) }
}
