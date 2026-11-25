import { Check, FileUp, Loader2, TriangleAlert } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MAX_FILE_BYTES, readImportFile } from '@/features/import/readers'
import { download, toCsv } from '@/features/masterdata/csv'
import { Alert, Button, Card } from '@/ui/primitives'
import { migrateVyapar, type Choices, type Report } from './engine'
import { apiServer } from './server'
import { isVyapar, parseVyapar, type VyData } from './vyapar'

type Step = 'choose' | 'upload' | 'review' | 'run' | 'done'
const n = (v: number): string => v.toLocaleString('en-IN')

const SOURCES = [
  { id: 'vyapar', name: 'Vyapar', text: 'Business, tax set-up, units, categories, customers, suppliers, items with prices and stock, and bank accounts. From a .vyp (desktop) or .vyb (phone) backup.', ready: true },
  { id: 'tally', name: 'Tally', text: 'Coming later. For now, export your lists to Excel and use Import data.', ready: false },
  { id: 'busy', name: 'Busy', text: 'Coming later. For now, export your lists to Excel and use Import data.', ready: false },
]

/** Move to OneSyncERP from another program: pick the program, give its backup file, check what was found, and bring it in. */
export function MigratePage() {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('choose')
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<VyData | null>(null)
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [choices, setChoices] = useState<Choices>({ business: true, catalogue: true, parties: true, banks: true, stock: true, assumeBusinessState: true })
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const stop = useRef(false)
  const batch = useRef(crypto.randomUUID().slice(0, 8))

  async function load(file: File | undefined) {
    if (!file) return
    setError(null); setReading(true)
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 300 MB.')
      const src = await readImportFile(file.name, new Uint8Array(await file.arrayBuffer()))
      if (!isVyapar(src)) throw new Error('This does not look like a Vyapar backup. Choose the .vyp or .vyb file that Vyapar saves with Backup.')
      setData(parseVyapar(src)); setFileName(file.name); setStep('review')
    } catch (e) { setError(e instanceof Error ? e.message : 'The file could not be read.') } finally { setReading(false) }
  }

  async function start() {
    if (!data) return
    stop.current = false; setStep('run'); setError(null)
    try {
      const r = await migrateVyapar(apiServer(), data, choices, batch.current, (phase, done, total) => setProgress({ phase, done, total }), () => stop.current)
      setReport(r); setStep('done')
      void qc.invalidateQueries()
    } catch (e) { setError(e instanceof Error ? e.message : 'The migration stopped.'); setStep('review') }
  }

  const counts = useMemo(() => data ? [
    ['Customers and suppliers', data.parties.length], ['Items', data.items.length], ['Item categories', data.categories.length], ['Units', data.units.length], ['Tax rates', data.taxes.length], ['Payment terms', data.terms.length], ['Bank accounts', data.banks.length],
  ] as [string, number][] : [], [data])

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div><h1 className="page-title">Move from another program</h1><p className="page-sub">Bring your business across in a few minutes. Nothing in your old program is changed, and you can check everything before it is saved.</p></div>
      {error ? <Alert>{error}</Alert> : null}

      {step === 'choose' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {SOURCES.map((s) => (
            <button key={s.id} type="button" disabled={!s.ready} onClick={() => setStep('upload')} className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-left enabled:hover:border-brand disabled:opacity-60">
              <span className="text-sm font-semibold">Migrate from {s.name}</span><span className="text-xs text-muted">{s.text}</span>
            </button>))}
        </div>) : null}

      {step === 'upload' ? (
        <Card title="Migrate from Vyapar">
          <div className="flex max-w-2xl flex-col gap-3 text-sm">
            <ol className="list-decimal pl-5 text-muted"><li>In Vyapar, open Settings, then Backup, and save a backup file.</li><li>Choose that file here (it ends in .vyp or .vyb; a zip of it also works).</li></ol>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line-strong bg-sunken px-6 py-10 text-center hover:border-brand">
              {reading ? <Loader2 className="size-6 animate-spin text-muted" aria-hidden /> : <FileUp className="size-6 text-muted" aria-hidden />}
              <span className="font-medium">{reading ? 'Reading the file…' : 'Choose your Vyapar backup file'}</span>
              <input type="file" className="sr-only" aria-label="Vyapar backup file" accept=".vyp,.vyb,.zip,application/octet-stream" onChange={(e) => void load(e.target.files?.[0])} />
            </label>
            <div><Button variant="ghost" onClick={() => setStep('choose')}>Back</Button></div>
          </div>
        </Card>) : null}

      {step === 'review' && data ? (
        <>
          <Card title={`Found in ${fileName}`}>
            <div className="flex flex-col gap-3 text-sm">
              {data.firm ? <p><b>{data.firm.name}</b>{data.firm.gstin ? ` · GSTIN ${data.firm.gstin}` : ''}{data.firm.state ? ` · ${data.firm.state}` : ''}</p> : <Alert>This file has no business details.</Alert>}
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 md:grid-cols-3">{counts.map(([k, v]) => <p key={k} className="flex justify-between border-b border-line/60 py-1"><span className="text-muted">{k}</span><b className="num">{n(v)}</b></p>)}</div>
              {data.warnings.map((w) => <p key={w} className="flex gap-2 text-warn"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{w}</p>)}
            </div>
          </Card>
          <Card title="What to bring in">
            <div className="flex flex-col gap-2 text-sm">
              {([['business', 'Business details, GST registration, location and warehouse (only what is missing)'], ['catalogue', `Units, tax rates, categories, payment terms and ${n(data.items.length)} items with their prices`], ['stock', 'Opening stock for items that have stock in Vyapar (as of today)'], ['parties', `${n(data.parties.length)} customers and suppliers with their addresses and credit limits`], ['banks', `${n(data.banks.length)} bank accounts`]] as [keyof Choices, string][]).map(([k, label]) => (
                <label key={k} className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={choices[k]} disabled={k === 'stock' && !choices.catalogue} onChange={(e) => setChoices((c) => ({ ...c, [k]: e.target.checked }))} /><span>{label}</span></label>))}
              <label className="flex items-start gap-2 pl-6 text-muted"><input type="checkbox" className="mt-0.5" checked={Boolean(choices.assumeBusinessState)} disabled={!choices.parties} onChange={(e) => setChoices((c) => ({ ...c, assumeBusinessState: e.target.checked }))} /><span>Where a party has no state, take it to be in your own state. This decides whether its invoices carry CGST and SGST or IGST, so correct any that are in another state.</span></label>
            </div>
          </Card>
          <Card title="Not brought in yet">
            <div className="flex flex-col gap-2 text-sm text-muted">
              <p>Your past documents are in the file but are not imported in this version, so your books start clean from today:</p>
              <ul className="grid grid-cols-1 gap-x-8 md:grid-cols-2">{data.documents.map((d) => <li key={d.kind} className="flex justify-between border-b border-line/60 py-1"><span>{d.kind}</span><span className="num">{n(d.count)}</span></li>)}</ul>
              <p>Keep your Vyapar backup safe as the record of the past. Party balances are also not carried over: record them as opening entries when you start.</p>
            </div>
          </Card>
          <div className="flex gap-2"><Button onClick={() => void start()} disabled={![choices.business, choices.catalogue, choices.parties, choices.banks].some(Boolean)}>Bring it in</Button><Button variant="ghost" onClick={() => { setData(null); setStep('upload') }}>Choose another file</Button></div>
        </>) : null}

      {step === 'run' ? (
        <Card title="Bringing your data in">
          <div className="flex flex-col gap-3 text-sm" role="status">
            <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" aria-hidden />{progress?.phase ?? 'Starting'}{progress && progress.total > 0 ? ` · ${n(progress.done)} of ${n(progress.total)}` : ''}</p>
            <div className="h-2 overflow-hidden rounded bg-sunken"><div className="h-full bg-brand transition-all" style={{ width: `${progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%` }} /></div>
            <p className="text-xs text-muted">Keep this window open. If it stops, run it again: what is already in is skipped.</p>
            <div><Button variant="secondary" onClick={() => { stop.current = true }}>Stop after this step</Button></div>
          </div>
        </Card>) : null}

      {step === 'done' && report ? (
        <>
          <Card title="Done">
            <div className="flex flex-col gap-3 text-sm">
              <table className="w-full"><thead><tr><th className="text-left">Step</th><th className="text-right">Added</th><th className="text-right">Already there</th><th className="text-right">Problems</th></tr></thead>
                <tbody>{report.phases.map((p) => <tr key={p.phase}><td>{p.phase}</td><td className="num text-right">{n(p.created)}</td><td className="num text-right">{n(p.skipped)}</td><td className={`num text-right ${p.failed ? 'font-medium text-bad' : ''}`}>{n(p.failed)}</td></tr>)}</tbody></table>
              {report.phases.flatMap((p) => p.notes.map((t) => <p key={`${p.phase}${t}`} className="flex gap-2 text-muted"><Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />{t}</p>))}
              {report.problems.length > 0 ? <div><Alert>{n(report.problems.length)} {report.problems.length === 1 ? 'thing needs' : 'things need'} your attention.</Alert><details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Show the first few</summary><ul className="mt-1 flex flex-col gap-0.5">{report.problems.slice(0, 15).map((p, i) => <li key={i}><b>{p.phase}</b> · {p.record}: {p.message}</li>)}</ul></details>
<div className="mt-2"><Button variant="secondary" onClick={() => download('vyapar-migration-problems.csv', toCsv(['Step', 'Record', 'Problem'], report.problems.map((p) => [p.phase, p.record, p.message])))}>Download the list</Button></div></div> : null}
            </div>
          </Card>
          <div><Button variant="secondary" onClick={() => { setStep('choose'); setData(null); setReport(null) }}>Start another</Button></div>
        </>) : null}
    </div>
  )
}
