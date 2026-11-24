/**
 * A read-only reader for SQLite database files, which is what several accounting apps keep their data in (Vyapar's .vyb backup, for one).
 * It walks the table pages itself, so no database engine has to be shipped. Binary columns are skipped; text is decoded; nothing is written.
 */
export interface SqlTable { name: string; columns: string[]; rows: (string | number | null)[][] }

const MAGIC = 'SQLite format 3\0'
export const isSqlite = (b: Uint8Array): boolean => b.length > 100 && String.fromCharCode(...b.subarray(0, 16)) === MAGIC

class Db {
  readonly view: DataView; readonly pageSize: number; readonly usable: number; readonly encoding: number
  constructor(readonly b: Uint8Array) {
    this.view = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const ps = this.view.getUint16(16); this.pageSize = ps === 1 ? 65_536 : ps
    this.usable = this.pageSize - this.view.getUint8(20)
    this.encoding = this.view.getUint32(56) || 1
    if (this.pageSize < 512 || (this.pageSize & (this.pageSize - 1)) !== 0) throw new Error('This database file is damaged.')
  }
  page(n: number): number { const o = (n - 1) * this.pageSize; if (n < 1 || o + this.pageSize > this.b.length) throw new Error('This database file is damaged or cut short.'); return o }
  varint(o: number): [number, number] {
    let v = 0
    for (let i = 0; i < 8; i++) { const c = this.b[o + i] as number; v = v * 128 + (c & 0x7f); if (!(c & 0x80)) return [v, i + 1] }
    return [v * 256 + (this.b[o + 8] as number), 9]
  }
  text(from: number, to: number): string {
    const s = this.b.subarray(from, to)
    return new TextDecoder(this.encoding === 2 ? 'utf-16le' : this.encoding === 3 ? 'utf-16be' : 'utf-8').decode(s)
  }
  /** The payload of a cell, joined up from overflow pages when it does not fit in its own page. */
  payload(o: number, total: number): Uint8Array {
    const x = this.usable - 35
    if (total <= x) return this.b.subarray(o, o + total)
    const m = Math.floor(((this.usable - 12) * 32) / 255) - 23
    const k = m + ((total - m) % (this.usable - 4))
    const local = k <= x ? k : m
    const out = new Uint8Array(total); out.set(this.b.subarray(o, o + local))
    let got = local; let next = this.view.getUint32(o + local)
    while (got < total && next !== 0) {
      const po = this.page(next); const take = Math.min(this.usable - 4, total - got)
      out.set(this.b.subarray(po + 4, po + 4 + take), got); got += take; next = this.view.getUint32(po)
    }
    if (got < total) throw new Error('This database file is damaged.')
    return out
  }
  record(p: Uint8Array): (string | number | null)[] {
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength)
    const read = (o: number): [number, number] => { let v = 0; for (let i = 0; i < 8; i++) { const c = p[o + i] as number; v = v * 128 + (c & 0x7f); if (!(c & 0x80)) return [v, i + 1] } return [v * 256 + (p[o + 8] as number), 9] }
    const [hlen, hn] = read(0); const types: number[] = []
    for (let o = hn; o < hlen;) { const [t, n] = read(o); types.push(t); o += n }
    const out: (string | number | null)[] = []; let o = hlen
    for (const t of types) {
      if (t === 0) out.push(null)
      else if (t >= 1 && t <= 6) { const n = [0, 1, 2, 3, 4, 6, 8][t] as number; out.push(n === 8 ? Number(dv.getBigInt64(o)) : n === 6 ? dv.getInt16(o) * 4_294_967_296 + dv.getUint32(o + 2) : readInt(dv, o, n)); o += n }
      else if (t === 7) { out.push(dv.getFloat64(o)); o += 8 }
      else if (t === 8) out.push(0)
      else if (t === 9) out.push(1)
      else if (t >= 12 && t % 2 === 0) { out.push(null); o += (t - 12) / 2 } // a binary value: not data to import
      else if (t >= 13) { const n = (t - 13) / 2; out.push(new TextDecoder(this.encoding === 2 ? 'utf-16le' : this.encoding === 3 ? 'utf-16be' : 'utf-8').decode(p.subarray(o, o + n))); o += n }
      else throw new Error('This database file is damaged.')
    }
    return out
  }
  /** Every row of a table b-tree, as [rowid, values]. */
  rows(root: number, limit: number): [number, (string | number | null)[]][] {
    const out: [number, (string | number | null)[]][] = []
    const walk = (n: number, depth: number): void => {
      if (depth > 40 || out.length >= limit) return
      const o = this.page(n); const base = n === 1 ? o + 100 : o; const type = this.view.getUint8(base); const cells = this.view.getUint16(base + 3)
      if (type === 0x0d) {
        for (let i = 0; i < cells && out.length < limit; i++) {
          let c = o + this.view.getUint16(base + 8 + i * 2)
          const [size, a] = this.varint(c); c += a; const [rowid, b] = this.varint(c); c += b
          out.push([rowid, this.record(this.payload(c, size))])
        }
      } else if (type === 0x05) {
        for (let i = 0; i < cells; i++) walk(this.view.getUint32(o + this.view.getUint16(base + 12 + i * 2)), depth + 1)
        walk(this.view.getUint32(base + 8), depth + 1)
      } else throw new Error('This database file uses a layout this version cannot read.')
    }
    walk(root, 0)
    return out
  }
}
function readInt(dv: DataView, o: number, n: number): number {
  if (n === 1) return dv.getInt8(o)
  if (n === 2) return dv.getInt16(o)
  if (n === 3) { const v = (dv.getUint8(o) << 16) | (dv.getUint8(o + 1) << 8) | dv.getUint8(o + 2); return v & 0x800000 ? v - 0x1000000 : v }
  return dv.getInt32(o)
}

/** Column names from a CREATE TABLE statement, and which one stands in for the row number. */
export function columnsOf(sqlText: string): { names: string[]; rowidAlias: number } {
  const open = sqlText.indexOf('('); const close = sqlText.lastIndexOf(')')
  if (open < 0 || close < open) return { names: [], rowidAlias: -1 }
  const defs: string[] = []; let depth = 0; let cur = ''; let quote = ''
  for (const ch of sqlText.slice(open + 1, close)) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue }
    if (ch === '[') { quote = ']'; cur += ch; continue }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { defs.push(cur); cur = '' } else cur += ch
  }
  defs.push(cur)
  const names: string[] = []; let rowidAlias = -1
  for (const d of defs) {
    const t = d.trim()
    if (/^(primary\s+key|unique|check|foreign\s+key|constraint)\b/i.test(t)) continue
    const m = /^(?:"((?:[^"]|"")*)"|`([^`]*)`|\[([^\]]*)\]|'([^']*)'|(\S+))\s*(.*)$/s.exec(t)
    if (!m) continue
    const name = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').replaceAll('""', '"')
    if (/^integer\s+primary\s+key\b/i.test((m[6] ?? '').trim())) rowidAlias = names.length
    names.push(name)
  }
  return { names, rowidAlias }
}

export function readSqlite(bytes: Uint8Array, limit = 200_000): SqlTable[] {
  if (!isSqlite(bytes)) throw new Error('This is not a database file.')
  const db = new Db(bytes); const tables: SqlTable[] = []
  for (const [, row] of db.rows(1, 100_000)) {
    const [type, name, , root, sqlText] = row
    if (type !== 'table' || typeof name !== 'string' || name.startsWith('sqlite_') || typeof root !== 'number' || root < 1 || typeof sqlText !== 'string' || /^\s*create\s+virtual/i.test(sqlText)) continue
    const { names, rowidAlias } = columnsOf(sqlText)
    if (names.length === 0) continue
    const rows = db.rows(root, limit).map(([rowid, v]) => { const r = names.map((_, i) => v[i] ?? null); if (rowidAlias >= 0) r[rowidAlias] = rowid; return r })
    tables.push({ name, columns: names, rows })
  }
  return tables
}
