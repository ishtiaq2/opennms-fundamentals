// A unified diff of two texts, made by git (git diff --no-index), so the studio needs no diff package.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../run.js'

const LONG_LINE = 240

export async function unifiedDiff(before: Buffer | string | null, after: Buffer | string, label: string, beforeLabel = 'now', afterLabel = 'new'): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'studio-diff-'))
  try {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    writeFileSync(a, before ?? '')
    writeFileSync(b, after)
    const r = await run('git', ['diff', '--no-index', '--no-color', '-U3', a, b], { quiet: true })
    const lines = r.stdout.toString().split('\n')
    const start = lines.findIndex((l) => l.startsWith('@@'))
    if (start < 0) return ''
    // A drawing is a few very long lines (the d="..." of a path): the page shows their beginning, not 2000 characters.
    const shorten = (line: string) => (line.length > LONG_LINE ? `${line.slice(0, LONG_LINE - 20)} ... [${line.length - LONG_LINE + 20} more characters]` : line)
    return [`--- ${label} (${beforeLabel})`, `+++ ${label} (${afterLabel})`, ...lines.slice(start).map(shorten)].join('\n').trimEnd() + '\n'
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** For files that are one long line (a compiled JavaScript bundle): the text around one position. */
export function excerpt(text: string, start: number, end: number, around = 90): string {
  const a = Math.max(0, start - around)
  const b = Math.min(text.length, end + around)
  return `${a > 0 ? '…' : ''}${text.slice(a, b)}${b < text.length ? '…' : ''}`
}
