// Two small archive readers, so that the studio needs no packages:
//  - readTar: the files of a tar stream (podman exec <container> tar -cf - ... sends several files in one go)
//  - readZipEntry: one file of a zip or jar (the stock topology stylesheet is inside a jar of OpenNMS)
import { inflateRawSync } from 'node:zlib'

/** The regular files of an (ustar or GNU) tar archive: path -> content. */
export function readTar(data: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  let offset = 0
  let longName: string | null = null
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const field = (start: number, length: number) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
    let name = field(0, 100)
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const type = String.fromCharCode(header[156] || 48)
    const prefix = field(345, 155)
    if (prefix && field(257, 6).startsWith('ustar')) name = `${prefix}/${name}`
    const body = data.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '')
      continue
    }
    if (longName) {
      name = longName
      longName = null
    }
    if (type === '0' || type === '\0' || type === '7') files.set(name.replace(/^\.\//, ''), Buffer.from(body))
  }
  return files
}

/** One file of a zip archive (a .jar is a zip), or null. */
export function readZipEntry(zip: Buffer, wanted: string): Buffer | null {
  // The end-of-central-directory record is in the last 64 KB + 22 bytes.
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const entries = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < entries && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null
    const method = zip.readUInt16LE(p + 10)
    const compressedSize = zip.readUInt32LE(p + 20)
    const nameLength = zip.readUInt16LE(p + 28)
    const extraLength = zip.readUInt16LE(p + 30)
    const commentLength = zip.readUInt16LE(p + 32)
    const localOffset = zip.readUInt32LE(p + 42)
    const name = zip.subarray(p + 46, p + 46 + nameLength).toString('utf8')
    if (name === wanted) {
      const localNameLength = zip.readUInt16LE(localOffset + 26)
      const localExtraLength = zip.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const raw = zip.subarray(start, start + compressedSize)
      if (method === 0) return Buffer.from(raw)
      if (method === 8) return inflateRawSync(raw)
      return null
    }
    p += 46 + nameLength + extraLength + commentLength
  }
  return null
}
