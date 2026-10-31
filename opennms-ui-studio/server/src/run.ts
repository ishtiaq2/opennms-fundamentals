// Runs a program (podman, ssh, git) without a shell and reports it in the command log, so that the page can show
// each command exactly as you would type it.
import { spawn } from 'node:child_process'
import { emit } from './events.js'

export interface RunResult {
  code: number
  stdout: Buffer
  stderr: string
  ms: number
}

export interface RunOptions {
  /** Bytes for the program's standard input (for example a file that podman exec -i writes into a container) */
  input?: Buffer | string
  timeoutMs?: number
  /** What the command log shows instead of the real command line (ssh hides the quoting of the remote command) */
  display?: string
  /** Which machine or container it is about: dev, prod, workspace */
  target?: string
  /** Not in the command log (frequent read-only checks) */
  quiet?: boolean
  env?: NodeJS.ProcessEnv
}

let nextId = 1

/** A word as a shell reads it: plain when it is safe, else in single quotes. */
export function shellQuote(word: string): string {
  if (word !== '' && /^[A-Za-z0-9_\-.,:/@%+=]+$/.test(word)) return word
  return `'${word.replace(/'/g, `'\\''`)}'`
}

export function shellLine(words: string[]): string {
  return words.map(shellQuote).join(' ')
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const id = nextId++
  const started = Date.now()
  if (!opts.quiet) {
    emit({
      type: 'command',
      id,
      target: opts.target ?? '',
      text: opts.display ?? shellLine([cmd, ...args]),
      time: new Date().toISOString(),
    })
  }
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: opts.env ?? process.env })
    const out: Buffer[] = []
    let err = ''
    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', (e) => (err += String(e)))
    child.stdin.on('error', () => undefined) // the program may exit before it read everything
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const result: RunResult = { code: code ?? -1, stdout: Buffer.concat(out), stderr: err, ms: Date.now() - started }
      if (!opts.quiet) {
        const text = (result.code === 0 ? result.stdout.toString('utf8') : err || result.stdout.toString('utf8')).trim()
        emit({
          type: 'command-done',
          id,
          code: result.code,
          ms: result.ms,
          output: text.length > 400 ? `${text.slice(0, 400)} ... (${text.length} characters)` : text,
        })
      }
      resolvePromise(result)
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}
