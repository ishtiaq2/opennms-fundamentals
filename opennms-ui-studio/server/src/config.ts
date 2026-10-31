// Settings. The OpenNMS side (production ssh login, container names, ports, the development login) comes from
// kit/kit.env, the settings file of the topology kit that creates the development OpenNMS, so both tools agree.
// studio.env holds the studio's own settings. A variable in the environment wins over both files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
/** The project folder: server/src (tsx) or server/dist (built) are two levels below it. */
export const ROOT = process.env.STUDIO_ROOT ? resolve(process.env.STUDIO_ROOT) : resolve(here, '..', '..')

/** Reads NAME=value lines of a shell settings file. NAME=${NAME:-value} gives value (the default of kit.env). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!m) continue
    let v = m[2]
    const withDefault = /^\$\{[A-Za-z_][A-Za-z0-9_]*:?-(.*?)\}(\s+#.*)?$/.exec(v)
    v = withDefault ? withDefault[1] : v.replace(/\s+#.*$/, '')
    v = v.trim()
    if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

function readEnv(path: string): Record<string, string> {
  return existsSync(path) ? parseEnvFile(readFileSync(path, 'utf8')) : {}
}

export interface TargetSettings {
  container: string
  /** OpenNMS's address as the studio's machine reaches it, for example http://127.0.0.1:8980/opennms */
  url: string
  user: string
  password: string
}

export interface StudioConfig {
  root: string
  kitDir: string
  workspace: string
  backups: string
  stateDir: string
  webDist: string
  port: number
  host: string
  /** The access token of the web page; null: no token (STUDIO_TOKEN=off) */
  token: string | null
  /** How podman is called on this machine, for example ['podman'] or ['sudo', 'podman'] */
  podman: string[]
  devPort: number
  dev: TargetSettings
  prodSsh: string
  prod: TargetSettings
}

export function loadConfig(root = ROOT): StudioConfig {
  const kitDir = resolve(root, process.env.STUDIO_KIT_DIR || 'kit')
  const kit = readEnv(join(kitDir, 'kit.env'))
  const studio = readEnv(join(root, 'studio.env'))
  const get = (name: string, fallback = ''): string => process.env[name] ?? studio[name] ?? kit[name] ?? fallback
  const stateDir = join(root, '.studio')
  mkdirSync(stateDir, { recursive: true })
  let token: string | null = get('STUDIO_TOKEN')
  if (token === 'off') token = null
  else if (!token) {
    const file = join(stateDir, 'token')
    if (!existsSync(file)) writeFileSync(file, randomBytes(16).toString('hex') + '\n', { mode: 0o600 })
    token = readFileSync(file, 'utf8').trim()
  }
  const devPort = Number(get('DEV_PORT', '8980'))
  return {
    root,
    kitDir,
    workspace: join(root, 'workspace'),
    backups: join(root, 'backups'),
    stateDir,
    webDist: join(root, 'web', 'dist'),
    port: Number(get('STUDIO_PORT', '8990')),
    host: get('STUDIO_HOST', '0.0.0.0'),
    token,
    podman: get('PODMAN', 'podman').split(/\s+/).filter(Boolean),
    devPort,
    dev: {
      container: get('DEV_CONTAINER', 'onms-dev-core'),
      url: get('STUDIO_DEV_URL', `http://127.0.0.1:${devPort}/opennms`),
      user: get('DEV_USER', 'admin'),
      password: get('DEV_PASSWORD', 'admin'),
    },
    prodSsh: get('PROD_SSH', 'maven-admin@192.168.0.36'),
    prod: {
      container: get('PROD_CONTAINER', 'opennms'),
      url: get('PROD_URL', 'http://192.168.0.36:8980/opennms'),
      user: get('PROD_USER', ''),
      password: get('PROD_PASSWORD', ''),
    },
  }
}
