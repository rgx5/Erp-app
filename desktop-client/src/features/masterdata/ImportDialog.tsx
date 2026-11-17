import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { Alert, Button } from '@/ui/primitives'
import { Drawer } from '@/ui/Drawer'
import { asRecords, download, parseCsv, toCsv } from './csv'

export interface ImportSpec<Input> {
  title: string
  /** File name and header of the template people can download. */
  template: { filename: string; header: string[]; example: string[] }
  /** Turns one CSV row into a request body, or says what is wrong with it. */
  parse(record: Record<string, string>): { input: Input } | { error: string }
  create(input: Input, key: string): Promise<unknown>
  /** What to refresh afterwards. */
  invalidate: string[]
  describe(input: Input): string
}

type RowState = { line: number; label: string; status: 'ready' | 'invalid' | 'created' | 'failed'; message?: string }

/** Import rows from a CSV file: checked row by row before anything is sent, then created one at a time with a report of what happened. */
export function ImportDialog<Input>({ spec, onClose }: { spec: ImportSpec<Input>; onClose: () => void }) {
  const qc = useQueryClient()
  const batch = useRef(crypto.randomUUID())
  const [rows, setRows] = useState<(RowState & { input?: Input })[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setFileError(null)
    const text = await file.text()
    const { header, records } = asRecords(parseCsv(text))
    const needed = spec.template.header.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ''))
    const missing = needed.slice(0, 2).filter((h) => !header.includes(h))
    if (records.length === 0 || missing.length > 0) { setRows(null); setFileError(records.length === 0 ? 'The file has no rows.' : `The file is missing the column(s): ${missing.join(', ')}. Download the template to see the layout.`); return }
    if (records.length > 2000) { setRows(null); setFileError('Import at most 2,000 rows at a time.'); return }
    setRows(records.map((r, i) => {
      const parsed = spec.parse(r)
      return 'input' in parsed ? { line: i + 2, label: spec.describe(parsed.input), status: 'ready', input: parsed.input } : { line: i + 2, label: Object.values(r).slice(0, 2).join(' · '), status: 'invalid', message: parsed.error }
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
      setRows([...next])
    }
    await Promise.all(spec.invalidate.map((k) => qc.invalidateQueries({ queryKey: [k] })))
    setBusy(false)
  }

  const count = (s: RowState['status']): number => rows?.filter((r) => r.status === s).length ?? 0
  const finished = rows !== null && count('ready') === 0 && (count('created') > 0 || count('failed') > 0)
  const problems = rows?.filter((r) => r.status === 'invalid' || r.status === 'failed') ?? []

  return (
    <Drawer title={spec.title} onClose={onClose} width={640}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => void pick(e.target.files?.[0])} disabled={busy} />
          <Button variant="secondary" onClick={() => download(spec.template.filename, toCsv(spec.template.header, [spec.template.example]))}>Download template</Button>
        </div>
        {fileError ? <Alert>{fileError}</Alert> : null}
        {rows ? (
          <>
            <p className="text-sm" role="status">{rows.length} rows · {count('ready')} ready{count('invalid') ? ` · ${count('invalid')} with problems` : ''}{count('created') ? ` · ${count('created')} created` : ''}{count('failed') ? ` · ${count('failed')} failed` : ''}</p>
            {problems.length > 0 ? (
              <ul className="max-h-60 overflow-auto rounded-md border border-line text-sm">
                {problems.map((p) => <li key={p.line} className="border-b border-line/60 px-3 py-1.5 last:border-0"><span className="font-medium">Row {p.line}</span> {p.label}: <span className="text-bad">{p.message}</span></li>)}
              </ul>
            ) : null}
            <div className="flex gap-2">
              {!finished ? <Button busy={busy} disabled={count('ready') === 0} onClick={() => void run()}>Import {count('ready')} rows</Button> : <Button onClick={onClose}>Done</Button>}
              {problems.length > 0 ? <Button variant="secondary" onClick={() => download('import-problems.csv', toCsv(['row', 'detail', 'problem'], problems.map((p) => [String(p.line), p.label, p.message ?? ''])))}>Download problems</Button> : null}
            </div>
            <p className="text-xs text-muted">Nothing is sent until you press Import. Rows that already exist are reported, not duplicated.</p>
          </>
        ) : null}
      </div>
    </Drawer>
  )
}
