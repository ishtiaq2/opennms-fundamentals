// The overlay folders. The OpenNMS image copies three folders into OpenNMS at every start of the container:
//
//   /opt/opennms-jetty-webapps-overlay   into jetty-webapps/   (opennms/svg/x.svg   -> jetty-webapps/opennms/svg/x.svg)
//   /opt/opennms-overlay                 into OpenNMS's home   (jetty-webapps/...   -> jetty-webapps/...)
//   /opt/opennms-etc-overlay             into etc/             (x.cfg               -> etc/x.cfg)
//
// On production they are host folders (/opt/maven-nms/data/overlays/...). A file written only into the running
// container is replaced by an older overlay copy at the next start, or is gone when the container is created again.
// So on production the studio writes each file twice: into the container (OpenNMS uses it at once) and into the
// overlay folder (OpenNMS gets it again at every start). These are the rules, the same as the topology kit's:
//
//   1. An overlay folder that holds a copy of the file already: that copy is replaced (every such copy).
//   -  Else a file below etc/ gets none when etc/ is on a volume (production's opennms_data-config keeps it).
//   2. Else, a file below jetty-webapps/ goes into the jetty-webapps overlay (opennms/ui/assets/x.js, ...).
//   3. Else into the overlay of OpenNMS's home (its path below the home), when that one is mounted.
//   4. Else a file below etc/ into the etc overlay.
//   5. Else no overlay folder takes it: the file is only in the container (the page says so).
//
// The development OpenNMS gets no overlay copies: its overlay folders are copies of production's that
// kit/dev.sh up refreshes, so the studio writes into dev's container only.
import type { Target } from './target.js'

export interface OverlayFolder {
  /** Where the folder is mounted in the container */
  dest: string
  /** What it is copied into, below OpenNMS's home ('' = the home itself) */
  base: string
  label: string
}

export const OVERLAY_FOLDERS: OverlayFolder[] = [
  { dest: '/opt/opennms-jetty-webapps-overlay', base: 'jetty-webapps/', label: 'the jetty-webapps overlay folder' },
  { dest: '/opt/opennms-overlay', base: '', label: 'the overlay folder of OpenNMS’s home' },
  { dest: '/opt/opennms-etc-overlay', base: 'etc/', label: 'the etc overlay folder' },
]

export interface OverlayCopy {
  folder: OverlayFolder
  /** The file's name below the overlay folder, for example opennms/ui/assets/index-2c7519b1.js */
  name: string
  /** Its path in the container (through the mount): what the studio reads and writes */
  inContainer: string
  /** Its path on the host machine, for the record and for the guide */
  onHost: string
  exists: boolean
}

export interface OverlayPlan {
  copies: OverlayCopy[]
  note: string
}

/** The names a file below OpenNMS's home can have in an overlay folder, most specific first. */
export function namesIn(folder: OverlayFolder, rel: string): string[] {
  if (!rel.startsWith(folder.base)) return []
  const below = rel.slice(folder.base.length)
  if (folder.dest.endsWith('jetty-webapps-overlay')) {
    // The jetty-webapps overlay may be laid out from jetty-webapps/ (opennms/svg/x.svg) or from a folder below it.
    const parts = below.split('/')
    return parts.map((_, i) => parts.slice(i).join('/')).filter(Boolean)
  }
  return [below]
}

/** Where a file goes besides the container. quiet: false puts its checks (test -e) into the command log (an apply). */
export async function planOverlay(t: Target, rel: string, opts: { quiet?: boolean } = {}): Promise<OverlayPlan> {
  const quiet = opts.quiet ?? true
  if (t.name === 'dev') {
    return { copies: [], note: 'The development OpenNMS: the container only (kit/dev.sh up copies production’s overlay folders for dev).' }
  }
  const mounts = await t.mounts()
  const mounted = OVERLAY_FOLDERS.flatMap((folder) => {
    const m = mounts.find((x) => x.Destination === folder.dest)
    return m ? [{ folder, hostFolder: m.Source }] : []
  })
  if (mounted.length === 0) {
    return { copies: [], note: 'No overlay folder is mounted into this container: the file is only in the container.' }
  }
  const found: OverlayCopy[] = []
  for (const { folder, hostFolder } of mounted) {
    for (const name of namesIn(folder, rel)) {
      const inContainer = `${folder.dest}/${name}`
      if (await t.existsAbs(inContainer, quiet)) {
        found.push({ folder, name, inContainer, onHost: `${hostFolder}/${name}`, exists: true })
        break
      }
    }
  }
  if (found.length) return { copies: found, note: 'Rule 1: an overlay folder holds a copy already; it is replaced.' }

  // OpenNMS's etc/ on a volume (production: the named volume opennms_data-config) keeps its files at every start and
  // in a new container on this machine. A new overlay copy would put an old version back at every start, after a
  // change made in OpenNMS itself (Change Icon), so etc files get none.
  const home = await t.home()
  const etcVolume = mounts.find((m) => m.Destination === '/opt/opennms/etc' || m.Destination === `${home}/etc`)
  if (rel.startsWith('etc/') && etcVolume) {
    return {
      copies: [],
      note: `OpenNMS’s etc/ is on a ${etcVolume.Type === 'volume' ? `volume (${etcVolume.Name ?? etcVolume.Source})` : `host folder (${etcVolume.Source})`}: it keeps this file at every start and in a new container on this machine, so no overlay copy is needed.`,
    }
  }

  const pick = (dest: string) => mounted.find((m) => m.folder.dest === dest)
  const jetty = pick('/opt/opennms-jetty-webapps-overlay')
  if (jetty && rel.startsWith('jetty-webapps/')) {
    // Laid out from jetty-webapps/ (opennms/...) unless the folder shows another layout.
    let name = rel.slice('jetty-webapps/'.length)
    const fromWebapp = !(await t.existsAbs(`${jetty.folder.dest}/opennms`, quiet)) && (await t.existsAbs(`${jetty.folder.dest}/WEB-INF`, quiet))
    if (fromWebapp && name.startsWith('opennms/')) name = name.slice('opennms/'.length)
    return {
      copies: [{ folder: jetty.folder, name, inContainer: `${jetty.folder.dest}/${name}`, onHost: `${jetty.hostFolder}/${name}`, exists: false }],
      note: 'Rule 2: a new copy in the jetty-webapps overlay folder.',
    }
  }
  const root = pick('/opt/opennms-overlay')
  if (root) {
    return {
      copies: [{ folder: root.folder, name: rel, inContainer: `${root.folder.dest}/${rel}`, onHost: `${root.hostFolder}/${rel}`, exists: false }],
      note: 'Rule 3: a new copy in the overlay folder of OpenNMS’s home.',
    }
  }
  const etc = pick('/opt/opennms-etc-overlay')
  if (etc && rel.startsWith('etc/')) {
    const name = rel.slice('etc/'.length)
    return {
      copies: [{ folder: etc.folder, name, inContainer: `${etc.folder.dest}/${name}`, onHost: `${etc.hostFolder}/${name}`, exists: false }],
      note: 'Rule 4: a new copy in the etc overlay folder.',
    }
  }
  return { copies: [], note: 'Rule 5: no overlay folder takes this file; it is only in the container.' }
}
