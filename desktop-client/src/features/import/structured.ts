import type { Grid } from './readers'

type Flat = Record<string, string>
const scalar = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v))

/** One record flattened to dotted keys: { a: { b: 1 }, tags: ['x','y'] } becomes { 'a.b': '1', tags: 'x, y' }. Lists of records are left out (they are tables of their own). */
export function flatten(v: unknown, prefix = '', out: Flat = {}, depth = 0): Flat {
  if (v === null || typeof v !== 'object') { out[prefix || 'value'] = scalar(v); return out }
  if (Array.isArray(v)) { if (v.every((x) => x === null || typeof x !== 'object')) out[prefix] = v.map(scalar).join(', '); return out }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (x !== null && typeof x === 'object' && !Array.isArray(x)) { if (depth < 4) flatten(x, key, out, depth + 1) } else flatten(x, key, out, depth + 1)
  }
  return out
}

const gridOf = (name: string, records: Flat[]): Grid | null => {
  if (records.length === 0) return null
  const cols: string[] = []; const seen = new Set<string>()
  for (const r of records) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k) }
  return { name, rows: [cols, ...records.map((r) => cols.map((c) => r[c] ?? ''))] }
}

/** Every list of records in a JSON file becomes a table (a top-level list, or lists inside an object, at any depth). Also reads one record per line. */
export function readJson(text: string): Grid[] {
  const src = text.replace(/^﻿/, '').trim()
  let json: unknown
  try { json = JSON.parse(src) } catch {
    const lines = src.split(/\r?\n/).filter((l) => l.trim())
    try { json = lines.map((l) => JSON.parse(l)) } catch { throw new Error('This is not a valid JSON file.') }
  }
  const grids: Grid[] = []
  const visit = (v: unknown, name: string, depth: number): void => {
    if (Array.isArray(v)) {
      if (v.length > 0 && v.every((x) => Array.isArray(x))) { // a list of rows: the first is the header
        const g: Grid = { name, rows: (v as unknown[][]).map((r) => r.map(scalar)) }; grids.push(g); return
      }
      const recs = v.filter((x) => x !== null && typeof x === 'object' && !Array.isArray(x))
      if (recs.length > 0) { const g = gridOf(name, recs.map((r) => flatten(r))); if (g) grids.push(g); return }
      return
    }
    if (v !== null && typeof v === 'object' && depth < 5) for (const [k, x] of Object.entries(v as Record<string, unknown>)) visit(x, depth === 0 ? k : `${name}.${k}`, depth + 1)
  }
  if (json !== null && typeof json === 'object' && !Array.isArray(json)) {
    const before = grids.length; visit(json, 'data', 0)
    if (grids.length === before) { const g = gridOf('data', [flatten(json)]); if (g) grids.push(g) } // a single record
  } else visit(json, 'data', 0)
  return grids
}

/** XML: every kind of element that carries values (attributes or text children) and is not just a wrapper becomes a table, one row per element. */
export function readXml(text: string): Grid[] {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) throw new Error('This is not a valid XML file.')
  const groups = new Map<string, Flat[]>()
  const leafText = (el: Element): string | null => (el.children.length === 0 ? (el.textContent ?? '').trim() : null)
  const visit = (el: Element): void => {
    const rec: Flat = {}; let hasValue = false
    for (const a of Array.from(el.attributes)) { rec[a.name] = a.value; hasValue = true }
    const seen = new Map<string, number>()
    for (const c of Array.from(el.children)) {
      const lt = leafText(c)
      if (lt !== null) { const n = (seen.get(c.localName) ?? 0) + 1; seen.set(c.localName, n); rec[n === 1 ? c.localName : `${c.localName}.${n}`] = lt; hasValue = true; for (const a of Array.from(c.attributes)) rec[`${c.localName}.${a.name}`] = a.value }
      else if (c.children.length > 0 && Array.from(c.children).every((g) => leafText(g) !== null) && !Array.from(c.children).some((g) => g.localName === c.localName)) { for (const g of Array.from(c.children)) rec[`${c.localName}.${g.localName}`] = leafText(g) ?? ''; hasValue = true } // a small nested block such as an address
    }
    if (hasValue) { const k = el.localName; const l = groups.get(k) ?? []; l.push(rec); groups.set(k, l) }
    for (const c of Array.from(el.children)) if (leafText(c) === null) visit(c)
  }
  visit(doc.documentElement)
  const grids: Grid[] = []
  for (const [name, recs] of groups) { const g = gridOf(name, recs); if (g) grids.push(g) }
  return grids
}
