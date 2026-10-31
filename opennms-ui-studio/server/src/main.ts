// The studio's web server: the page (web/dist) and its API (/api/...). Start it with npm start (built) or npm run dev.
import { existsSync, readFileSync, statSync, watch } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { applyTopology, previewData, summary, topologyPlan, topologyState, writeCss, writeMappings } from './modules/topology.js'
import { applyMenu, menuPlan, menuState, readLabels, writeLabels, type Labels } from './modules/menu.js'
import { journal, undoLast } from './changes.js'
import { loadConfig } from './config.js'
import { emit, step, subscribe } from './events.js'
import { History } from './history.js'
import { targets, type TargetName } from './target.js'

const config = loadConfig()
const history = new History(config)
const T = targets(config)

// ---- The workspace: created with its first files on the first start ------------------------------------------

const template = join(config.kitDir, 'tools', 'topology.css.template')
await history.init({
  'README.md': readFileSync(join(config.root, 'server', 'assets', 'workspace-README.md'), 'utf8'),
  'topology/topology.css': existsSync(template) ? readFileSync(template, 'utf8') : '/* Your CSS for /opennms/topology. */\n',
  'topology/icon-mappings.json': '{}\n',
  'menu/labels.json': JSON.stringify({ plugins: null, menuNames: {} }, null, 2) + '\n',
  '.gitignore': '# copies that kit/topo.sh revert keeps of your CSS\n*.bak\n',
})

// A change in workspace/ (by the studio, an editor, or git) tells the pages to read it again.
let changedTimer: NodeJS.Timeout | undefined
try {
  watch(config.workspace, { recursive: true }, (_event, file) => {
    if (!file || String(file).startsWith('.git')) return
    clearTimeout(changedTimer)
    changedTimer = setTimeout(() => emit({ type: 'changed', what: 'workspace' }), 300)
  })
} catch {
  // recursive watching is not available on this system: the page reloads its data when you switch views
}

// ---- Small helpers ------------------------------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function send(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 5_000_000) throw new HttpError(413, 'Too large')
    chunks.push(chunk as Buffer)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'The request is not JSON')
  }
}

function targetOf(value: unknown): TargetName {
  if (value === 'dev' || value === 'prod') return value
  throw new HttpError(400, 'target must be dev or prod')
}

function needConfirm(target: TargetName, data: Record<string, unknown>): void {
  if (target === 'prod' && data.confirm !== 'production') {
    throw new HttpError(400, 'Changing production needs confirm: "production"')
  }
}

// One change at a time: an apply, an undo or a restart.
let busy: string | null = null
async function exclusive<R>(what: string, work: () => Promise<R>): Promise<R> {
  if (busy) throw new HttpError(409, `Wait: ${busy} is running`)
  busy = what
  try {
    return await work()
  } finally {
    busy = null
  }
}

function cookie(req: IncomingMessage, name: string): string | null {
  const all = req.headers.cookie ?? ''
  for (const part of all.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

function hostAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return 'localhost'
}

// ---- The API ------------------------------------------------------------------------------------------------------

type Handler = (req: IncomingMessage, url: URL, res: ServerResponse) => Promise<unknown>
const routes = new Map<string, Handler>()
const route = (method: string, path: string, h: Handler) => routes.set(`${method} ${path}`, h)

route('GET', '/api/status', async () => {
  const [devUp, prodReach] = await Promise.all([T.dev.running(), T.prod.reachable()])
  const prodUp = prodReach.ok ? await T.prod.running() : false
  return {
    version: '1.0.0',
    workspace: { path: config.workspace, branch: await history.branch(), head: await history.head(), changes: (await history.status()).length },
    dev: { container: config.dev.container, url: config.dev.url, port: config.devPort, running: devUp },
    prod: { ssh: config.prodSsh, container: config.prod.container, url: config.prod.url, reachable: prodReach.ok, message: prodReach.message, running: prodUp },
    busy,
  }
})

route('GET', '/api/topology', async () => summary(config))
route('PUT', '/api/topology/css', async (req) => {
  const data = await body(req)
  if (typeof data.css !== 'string') throw new HttpError(400, 'css missing')
  writeCss(config, data.css)
  return summary(config)
})
route('PUT', '/api/topology/mappings', async (req) => {
  const data = await body(req)
  writeMappings(config, (data.mappings ?? {}) as Record<string, string>)
  return summary(config)
})
route('POST', '/api/topology/import', async (req) => {
  const data = await body(req)
  const path = String(data.path ?? '').replace(/^~(?=\/)/, process.env.HOME ?? '~')
  if (!path.endsWith('.css') || !existsSync(path) || !statSync(path).isFile()) throw new HttpError(400, `Not a .css file: ${path}`)
  writeCss(config, readFileSync(path, 'utf8'))
  step('workspace', `Imported ${path} into workspace/topology/topology.css`)
  return summary(config)
})
route('GET', '/api/topology/preview', async (_req, url) =>
  previewData(config, T[targetOf(url.searchParams.get('target') ?? 'dev')], url.searchParams.get('refresh') === '1'),
)
route('GET', '/api/topology/state', async (_req, url) => topologyState(config, T[targetOf(url.searchParams.get('target'))]))
route('GET', '/api/topology/plan', async (_req, url) => topologyPlan(config, T[targetOf(url.searchParams.get('target'))]))
route('POST', '/api/topology/apply', async (req) => {
  const data = await body(req)
  const target = targetOf(data.target)
  needConfirm(target, data)
  return exclusive(`applying the topology to ${target}`, () => applyTopology(config, history, T[target]))
})

route('GET', '/api/menu/state', async (_req, url) => menuState(config, T[targetOf(url.searchParams.get('target'))]))
route('PUT', '/api/menu/labels', async (req) => {
  const data = await body(req)
  const current = readLabels(config)
  const labels: Labels = {
    plugins: data.plugins === undefined ? current.plugins : data.plugins === null || data.plugins === '' ? null : String(data.plugins).trim(),
    menuNames: (data.menuNames as Record<string, string> | undefined) ?? current.menuNames,
  }
  writeLabels(config, labels)
  return readLabels(config)
})
route('GET', '/api/menu/plan', async (_req, url) => menuPlan(config, T[targetOf(url.searchParams.get('target'))]))
route('POST', '/api/menu/apply', async (req) => {
  const data = await body(req)
  const target = targetOf(data.target)
  needConfirm(target, data)
  return exclusive(`applying the menu labels to ${target}`, () => applyMenu(config, history, T[target]))
})

route('POST', '/api/dev/restart', async () =>
  exclusive('restarting the development OpenNMS', async () => {
    step('dev', `Restarting ${T.dev.where}. Its start copies the overlay folders in again, then OpenNMS needs a few minutes.`)
    const r = await T.dev.restart()
    if (r.code !== 0) throw new HttpError(500, `podman restart failed: ${r.stderr.trim()}`)
    const started = Date.now()
    while (Date.now() - started < 15 * 60 * 1000) {
      const answer = await T.dev.http('login.jsp')
      if (answer.status >= 200 && answer.status < 400) {
        step('dev', `The development OpenNMS answers again (after ${Math.round((Date.now() - started) / 1000)} s).`, true)
        return { ok: true, seconds: Math.round((Date.now() - started) / 1000) }
      }
      await new Promise((r) => setTimeout(r, 5000))
    }
    step('dev', 'The development OpenNMS did not answer within 15 minutes: kit/dev.sh status says why.', false)
    return { ok: false }
  }),
)

route('GET', '/api/history', async () => ({
  branch: await history.branch(),
  head: await history.head(),
  changes: await history.status(),
  diff: await history.diff(),
  log: await history.log(),
  branches: await history.branches(),
}))
route('GET', '/api/history/diff', async (_req, url) => ({
  diff: await history.diff(url.searchParams.get('from') || undefined, url.searchParams.get('to') || undefined, url.searchParams.getAll('path')),
}))
route('GET', '/api/history/show', async (_req, url) => ({
  text: await history.show(url.searchParams.get('commit') ?? 'HEAD', url.searchParams.get('path') ?? ''),
}))
route('POST', '/api/history/snapshot', async (req) => {
  const data = await body(req)
  return { commit: await history.snapshot(String(data.message ?? 'Snapshot')) }
})
route('POST', '/api/history/experiment', async (req) => {
  const data = await body(req)
  return { branch: await history.newExperiment(String(data.name ?? '')) }
})
route('POST', '/api/history/switch', async (req) => {
  const data = await body(req)
  await history.switchTo(String(data.branch ?? ''))
  return { branch: await history.branch() }
})
route('POST', '/api/history/restore', async (req) => {
  const data = await body(req)
  await history.restore(String(data.commit ?? ''), (data.paths as string[] | undefined) ?? [])
  return { ok: true }
})

route('GET', '/api/deploys', async () => journal(config).reverse())
route('POST', '/api/deploys/undo', async (req) => {
  const data = await body(req)
  const target = targetOf(data.target)
  const module = data.module === undefined || data.module === null ? undefined : String(data.module)
  if (module !== undefined && module !== 'topology' && module !== 'menu') throw new HttpError(400, 'module must be topology or menu')
  needConfirm(target, data)
  return exclusive(`undoing on ${target}`, () => undoLast(config, T[target], module))
})

// ---- Static files of the page -------------------------------------------------------------------------------------

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
}

function serveStatic(url: URL, res: ServerResponse): void {
  const dist = config.webDist
  if (!existsSync(join(dist, 'index.html'))) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('The page is not built yet: run npm run build (or npm run dev and open the address it prints).\n')
    return
  }
  let file = normalize(join(dist, decodeURIComponent(url.pathname)))
  if (!file.startsWith(resolve(dist)) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html')
  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'max-age=3600' })
  res.end(readFileSync(file))
}

// ---- The server ---------------------------------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://studio')
  try {
    if (config.token) {
      const given = url.searchParams.get('token')
      if (given && given === config.token) {
        url.searchParams.delete('token')
        res.writeHead(302, {
          'Set-Cookie': `studio_token=${config.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
          Location: url.pathname + (url.search || ''),
        })
        res.end()
        return
      }
      if (url.pathname.startsWith('/api/') && cookie(req, 'studio_token') !== config.token && req.headers['x-studio-token'] !== config.token) {
        send(res, 401, { error: 'Open the address with ?token=... that the studio printed when it started (or see .studio/token).' })
        return
      }
    }
    if (url.pathname === '/api/events') {
      subscribe(res)
      return
    }
    if (url.pathname.startsWith('/api/')) {
      const handler = routes.get(`${req.method} ${url.pathname}`)
      if (!handler) throw new HttpError(404, `No such API: ${req.method} ${url.pathname}`)
      send(res, 200, await handler(req, url, res))
      return
    }
    serveStatic(url, res)
  } catch (e) {
    const err = e as Error
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) step('studio', `Error: ${err.message}`, false)
    send(res, status, { error: err.message })
  }
})

server.listen(config.port, config.host, () => {
  const address = config.host === '0.0.0.0' ? hostAddress() : config.host
  const link = `http://${address}:${config.port}/${config.token ? `?token=${config.token}` : ''}`
  console.log(`OpenNMS UI Studio is running. Open in a browser:\n\n  ${link}\n`)
  console.log(`Workspace (a git repository): ${config.workspace}`)
  console.log(`Development OpenNMS: ${T.dev.where}, ${config.dev.url}`)
  console.log(`Production: ${T.prod.where}, ${config.prod.url}`)
})
