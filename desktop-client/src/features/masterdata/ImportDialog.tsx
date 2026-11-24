import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { autoMap, codeFromName, norm, scoreColumn, scoreTable, type TargetField } from '@/features/import/mapping'
import { FORMATS_NOTE, readImportFile, type ImportSource, type SourceTable } from '@/features/import/readers'
import { Alert, Button } from '@/ui/primitives'
import { Drawer } from '@/ui/Drawer'
import { download, toCsv } from './csv'

/** A field whose file values must become one of our own choices (a unit, a tax code, a role). */
export interface ValueField { key: string; label: string; options: { value: string; label: string }[]; /** Our choice for a value found in the file, or null when it needs a person to say. */ resolve(raw: string): string | null }

export interface ImportSpec<Input> {
  title: string
  /** File name and header of the template people can download. */
  template: { filename: string; header: string[]; example: string[] }
  /** Turns one row (keyed by the template's headers, lower case, letters and digits only) into a request body, or says what is wrong with it. */
  parse(record: Record<string, string>): { input: Input } | { error: string }
  create(input: Input, key: string): Promise<unknown>
  /** What to refresh afterwards. */
  invalidate: string[]
  describe(input: Input): string
  /** The field that names the record. When set, it is the only required field and a missing code is made from it. */
  nameKey?: string
  /** Words in a table's name that suggest it holds this kind of record (for files with many tables). */
  hints?: string[]
  /** Fields whose values are translated to our own choices. */
  values?: ValueField[]
}

type RowState = { line: number; label: string; status: 'ready' | 'invalid' | 'created' | 'failed'; message?: string }
type Rec = Record<string, string>
const MAX_ROWS = 10_000

const fieldsOf = <I,>(spec: ImportSpec<I>): TargetField[] =>
  spec.template.header.map((h, i) => ({ key: norm(h), label: h, required: spec.nameKey ? norm(h) === spec.nameKey : i < 2 }))

/** Import from a data file: CSV, Excel, JSON, XML, a database or backup file (such as Vyapar's .vyb), or a zip of those. The columns are matched to our fields (and can be changed), values are translated where needed, every row is checked before anything is sent, and the report says what happened to each. */
export function ImportDialog<Input>({ spec, onClose }: { spec: ImportSpec<Input>; onClose: () => void }) {
  const qc = useQueryClient()
  const batch = useRef(crypto.randomUUID())
  const fields = useMemo(() => fieldsOf(spec), [spec])
  const [source, setSource] = useState<(ImportSource & { fileName: string }) | null>(null)
  const [tableIdx, setTableIdx] = useState(0)
  const [map, setMap] = useState<Record<string, number>>({})
  const [trans, setTrans] = useState<Record<string, Record<string, string>>>({})
  const [rows, setRows] = useState<(RowState & { input?: Input })[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const table: SourceTable | undefined = source?.tables[tableIdx]

  const ranked = useMemo(() => (source ? source.tables.map((t, i) => ({ i, s: scoreTable(t, fields, spec.hints ?? []) })).sort((a, b) => b.s - a.s) : []), [source, fields, spec.hints])

  function choose(src: ImportSource & { fileName: string }, idx: number) {
    const t = src.tables[idx] as SourceTable
    setTableIdx(idx); setTrans({}); setRows(null)
    const m = autoMap(t.columns, fields); setMap(m)
    const needed = fields.filter((f) => f.required)
    const exact = needed.every((f) => m[f.key] !== undefined && scoreColumn(t.columns[m[f.key] as number] as string, f) >= 3)
    const unresolved = (spec.values ?? []).some((v) => m[v.key] !== undefined && distinct(t, m[v.key] as number).some((raw) => v.resolve(raw) === null))
    if (src.tables.length === 1 && exact && !unresolved) review(t, m, {}) // a file that already fits needs no matching step
  }

  async function pick(file: File | undefined) {
    if (!file) return
    setFileError(null); setRows(null); setSource(null)
    try {
      const src = { ...(await readImportFile(file.name, new Uint8Array(await file.arrayBuffer()))), fileName: file.name }
      setSource(src)
      choose(src, bestOf(src, fields, spec.hints ?? []))
    } catch (e) { setFileError(e instanceof Error ? e.message : 'This file could not be read.') }
  }

  const distinct = (t: SourceTable, col: number): string[] => { const s = new Set<string>(); for (const r of t.rows) { const v = (r[col] ?? '').trim(); if (v) s.add(v); if (s.size >= 500) break } return [...s] }
  const translate = (v: ValueField, raw: string, t: Record<string, Record<string, string>>): string => (t[v.key]?.[raw] !== undefined ? (t[v.key] as Record<string, string>)[raw] as string : v.resolve(raw) ?? raw)

  const missing = fields.filter((f) => f.required && map[f.key] === undefined)
  const unresolvedValues = useMemo(() => (table ? (spec.values ?? []).flatMap((v) => (map[v.key] === undefined ? [] : distinct(table, map[v.key] as number).filter((raw) => v.resolve(raw) === null && trans[v.key]?.[raw] === undefined).map((raw) => ({ v, raw })))) : []), [table, map, trans, spec.values]) // eslint-disable-line react-hooks/exhaustive-deps

  function review(t: SourceTable, m: Record<string, number>, tr: Record<string, Record<string, string>>) {
    if (t.rows.length > MAX_ROWS) { setRows(null); setFileError(`Import at most ${MAX_ROWS.toLocaleString('en-IN')} rows at a time. This table has ${t.rows.length.toLocaleString('en-IN')}.`); return }
    setFileError(null)
    const used = new Set<string>(); const records: Rec[] = []
    for (const r of t.rows) {
      const rec: Rec = {}
      for (const f of fields) { const c = m[f.key]; rec[f.key] = c === undefined ? '' : (r[c] ?? '').trim() }
      for (const v of spec.values ?? []) if (rec[v.key]) rec[v.key] = translate(v, rec[v.key] as string, tr)
      records.push(rec)
    }
    for (const rec of records) if (rec['code']) used.add((rec['code'] as string).toLowerCase())
    setRows(records.map((rec, i) => {
      if (spec.nameKey && !rec['code'] && rec[spec.nameKey]) rec['code'] = codeFromName(rec[spec.nameKey] as string, used)
      const parsed = spec.parse(rec)
      return 'input' in parsed ? { line: i + 2, label: spec.describe(parsed.input), status: 'ready', input: parsed.input } : { line: i + 2, label: [rec['code'], rec[spec.nameKey ?? 'name']].filter(Boolean).join(' · ') || Object.values(rec).filter(Boolean).slice(0, 2).join(' · '), status: 'invalid', message: parsed.error }
    }))
  }

  async function run() {
    if (!rows) return
    setBusy(true)
    const next = [...rows]
    for (let i = 0; i < next.length; i++) {
      const row = next[i] as RowState & { input?: Input }
      if (row.status !== 'ready' || row.input === undefined) continue
      try { await spec.create(row.input, `import-${batch.current}-${row.line}`); next[i] = { ...row, status: 'created' } }
      catch (e) { next[i] = { ...row, status: 'failed', message: e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Failed' } }
      if (i % 20 === 0 || i === next.length - 1) setRows([...next])
    }
    setRows([...next])
    await Promise.all(spec.invalidate.map((k) => qc.invalidateQueries({ queryKey: [k] })))
    setBusy(false)
  }

  const count = (s: RowState['status']): number => rows?.filter((r) => r.status === s).length ?? 0
  const finished = rows !== null && count('ready') === 0 && (count('created') > 0 || count('failed') > 0)
  const problems = rows?.filter((r) => r.status === 'invalid' || r.status === 'failed') ?? []
  const sample = (col: number | undefined): string => (col === undefined || !table ? '' : table.rows.slice(0, 3).map((r) => r[col] ?? '').filter(Boolean).join(' · '))

  return (
    <Drawer title={spec.title} onClose={onClose} width={680}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" aria-label="Data file" onChange={(e) => void pick(e.target.files?.[0])} disabled={busy} />
          <Button variant="secondary" onClick={() => download(spec.template.filename, toCsv(spec.template.header, [spec.template.example]))}>Download template</Button>
        </div>
        <p className="text-xs text-muted">Accepts {FORMATS_NOTE}. Columns are matched for you and can be changed.</p>
        {fileError ? <Alert>{fileError}</Alert> : null}

        {source && table && rows === null ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm" role="status">{source.format}: {source.fileName}</p>
            {source.tables.length > 1 ? (
              <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Which table or sheet holds the data?</span>
                <select aria-label="Table or sheet" className="h-9 rounded-md border border-line bg-surface px-2" value={tableIdx} onChange={(e) => choose(source, Number(e.target.value))}>
                  {ranked.map(({ i }) => <option key={i} value={i}>{(source.tables[i] as SourceTable).name} · {(source.tables[i] as SourceTable).rows.length.toLocaleString('en-IN')} rows</option>)}
                </select></label>
            ) : null}
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1">Our field</th><th className="py-1">Column in the file</th><th className="py-1">Example</th></tr></thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.key} className="border-t border-line/60">
                    <td className="py-1.5">{f.label}{f.required ? <span className="text-bad"> *</span> : ''}</td>
                    <td className="py-1.5"><select aria-label={`Column for ${f.label}`} className="h-8 w-56 rounded-md border border-line bg-surface px-2" value={map[f.key] ?? ''} onChange={(e) => setMap((m) => { const n = { ...m }; if (e.target.value === '') delete n[f.key]; else n[f.key] = Number(e.target.value); return n })}>
                      <option value="">(not in the file)</option>
                      {table.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}</select></td>
                    <td className="max-w-48 truncate py-1.5 text-muted">{sample(map[f.key])}</td>
                  </tr>))}
              </tbody>
            </table>
            {unresolvedValues.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-md border border-line p-3">
                <p className="text-sm font-medium">These values in the file are not ones we know. Say what each means.</p>
                {unresolvedValues.slice(0, 30).map(({ v, raw }) => (
                  <label key={`${v.key}:${raw}`} className="flex items-center gap-2 text-sm"><span className="w-44 truncate text-muted">{v.label}: <b className="text-ink">{raw}</b></span>
                    <select aria-label={`${v.label} for ${raw}`} className="h-8 rounded-md border border-line bg-surface px-2" value="" onChange={(e) => setTrans((t) => ({ ...t, [v.key]: { ...t[v.key], [raw]: e.target.value } }))}>
                      <option value="" disabled>Choose…</option><option value="__empty">Leave empty</option>{v.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>))}
                {unresolvedValues.length > 30 ? <p className="text-xs text-muted">{unresolvedValues.length - 30} more after these.</p> : null}
              </div>
            ) : null}
            {missing.length > 0 ? <Alert tone="info">Choose a column for: {missing.map((f) => f.label).join(', ')}.</Alert> : null}
            <div className="flex gap-2"><Button disabled={missing.length > 0 || unresolvedValues.length > 0} onClick={() => review(table, map, Object.fromEntries(Object.entries(trans).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([r, x]) => [r, x === '__empty' ? '' : x]))])))}>Check {table.rows.length.toLocaleString('en-IN')} rows</Button></div>
          </div>
        ) : null}

        {rows ? (
          <>
            <p className="text-sm" role="status">{rows.length} rows · {count('ready')} ready{count('invalid') ? ` · ${count('invalid')} with problems` : ''}{count('created') ? ` · ${count('created')} created` : ''}{count('failed') ? ` · ${count('failed')} failed` : ''}</p>
            {problems.length > 0 ? (
              <ul className="max-h-60 overflow-auto rounded-md border border-line text-sm">
                {problems.slice(0, 300).map((p) => <li key={p.line} className="border-b border-line/60 px-3 py-1.5 last:border-0"><span className="font-medium">Row {p.line}</span> {p.label}: <span className="text-bad">{p.message}</span></li>)}
              </ul>
            ) : null}
            {problems.length > 300 ? <p className="text-xs text-muted">The first 300 problems are shown; download the list for all {problems.length}.</p> : null}
            <div className="flex flex-wrap gap-2">
              {!finished ? <Button busy={busy} disabled={count('ready') === 0} onClick={() => void run()}>Import {count('ready')} rows</Button> : <Button onClick={onClose}>Done</Button>}
              {!busy && !finished && source ? <Button variant="secondary" onClick={() => setRows(null)}>Change the matching</Button> : null}
              {problems.length > 0 ? <Button variant="secondary" onClick={() => download('import-problems.csv', toCsv(['row', 'detail', 'problem'], problems.map((p) => [String(p.line), p.label, p.message ?? ''])))}>Download problems</Button> : null}
            </div>
            <p className="text-xs text-muted">Nothing is sent until you press Import. Rows that already exist are reported, not duplicated.</p>
          </>
        ) : null}
      </div>
    </Drawer>
  )
}

const bestOf = (src: ImportSource, fields: TargetField[], hints: string[]): number => {
  let best = 0; let score = -1
  src.tables.forEach((t, i) => { const s = scoreTable(t, fields, hints); if (s > score) { score = s; best = i } })
  return best
}
