/** A small zip reader: lists the files in an archive and unpacks one (stored or deflated). Enough for spreadsheets and zipped exports; no zip64, no passwords. */
export interface ZipEntry { name: string; size: number; read(): Promise<Uint8Array> }

const u16 = (b: Uint8Array, o: number): number => (b[o] as number) | ((b[o + 1] as number) << 8)
const u32 = (b: Uint8Array, o: number): number => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0

export const isZip = (b: Uint8Array): boolean => b.length > 30 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This computer cannot unpack zip files.')
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close() } })
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader()
  const parts: Uint8Array[] = []; let total = 0
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value as Uint8Array); total += (value as Uint8Array).length }
  const out = new Uint8Array(total); let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  if (expected > 0 && out.length !== expected) throw new Error('The zip file is damaged.')
  return out
}

export function readZip(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('This is not a readable zip file.')
  const count = u16(bytes, eocd + 10); let p = u32(bytes, eocd + 16)
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('The zip file is damaged.')
    const flags = u16(bytes, p + 8); const method = u16(bytes, p + 10); const csize = u32(bytes, p + 20); const usize = u32(bytes, p + 24)
    const nameLen = u16(bytes, p + 28); const extraLen = u16(bytes, p + 30); const commentLen = u16(bytes, p + 32); const local = u32(bytes, p + 42)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    entries.push({
      name, size: usize,
      async read() {
        if (flags & 1) throw new Error('This zip file is password protected.')
        if (u32(bytes, local) !== 0x04034b50) throw new Error('The zip file is damaged.')
        const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28)
        const data = bytes.subarray(start, start + csize)
        if (method === 0) return data
        if (method === 8) return inflateRaw(data, usize)
        throw new Error('This zip file uses a compression this version cannot open.')
      },
    })
  }
  return entries
}
