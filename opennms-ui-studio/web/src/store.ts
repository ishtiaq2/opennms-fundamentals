// What every view shares: the state of both OpenNMS, and the live command log from the server (Server-Sent Events).
import { reactive } from 'vue'
import { api, type Status } from './api'

export interface LogEntry {
  id: number
  kind: 'command' | 'step'
  target: string
  text: string
  time: string
  code?: number
  ms?: number
  output?: string
  ok?: boolean
}

export const store = reactive({
  status: null as Status | null,
  statusError: '',
  log: [] as LogEntry[],
  /** Counts up whenever the workspace changed on disk (by the studio, an editor or git) */
  workspaceVersion: 0,
  logOpen: false,
})

export async function refreshStatus(): Promise<void> {
  try {
    store.status = await api.status()
    store.statusError = ''
  } catch (e) {
    store.statusError = (e as Error).message
  }
}

let stepId = -1

export function connectEvents(): void {
  const source = new EventSource('/api/events')
  source.addEventListener('command', (e) => {
    const d = JSON.parse((e as MessageEvent).data)
    if (!store.log.some((x) => x.kind === 'command' && x.id === d.id)) store.log.push({ id: d.id, kind: 'command', target: d.target, text: d.text, time: d.time })
    trim()
  })
  source.addEventListener('command-done', (e) => {
    const d = JSON.parse((e as MessageEvent).data)
    const entry = store.log.find((x) => x.kind === 'command' && x.id === d.id)
    if (entry) Object.assign(entry, { code: d.code, ms: d.ms, output: d.output })
  })
  source.addEventListener('step', (e) => {
    const d = JSON.parse((e as MessageEvent).data)
    store.log.push({ id: stepId--, kind: 'step', target: d.target, text: d.text, time: new Date().toISOString(), ok: d.ok })
    trim()
  })
  source.addEventListener('changed', () => {
    store.workspaceVersion++
  })
}

function trim(): void {
  if (store.log.length > 500) store.log.splice(0, store.log.length - 500)
}
