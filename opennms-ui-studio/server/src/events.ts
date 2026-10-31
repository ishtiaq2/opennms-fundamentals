// Everything the studio does is told to the web page as it happens (Server-Sent Events): each command it runs on
// this machine, in a container or over ssh, and each step of an apply. The page shows them in its command log.
import type { ServerResponse } from 'node:http'

export type StudioEvent =
  | { type: 'command'; id: number; target: string; text: string; time: string }
  | { type: 'command-done'; id: number; code: number; ms: number; output: string }
  | { type: 'step'; target: string; text: string; ok?: boolean }
  | { type: 'changed'; what: string }

const clients = new Set<ServerResponse>()
const recent: StudioEvent[] = []

export function emit(event: StudioEvent): void {
  recent.push(event)
  if (recent.length > 400) recent.splice(0, recent.length - 400)
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  for (const res of clients) res.write(data)
}

export function step(target: string, text: string, ok?: boolean): void {
  emit({ type: 'step', target, text, ok })
}

/** GET /api/events: the page keeps this answer open and gets every event, starting with the recent ones. */
export function subscribe(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
  for (const event of recent) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  clients.add(res)
  const ping = setInterval(() => res.write(': ping\n\n'), 25000)
  res.on('close', () => {
    clearInterval(ping)
    clients.delete(res)
  })
}
