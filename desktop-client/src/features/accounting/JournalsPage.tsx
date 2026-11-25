import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import type { JournalHeader, LedgerAccount } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { compare, fromUnits, isValid, sub, sum, toUnits } from '@/domain/money'
import { ApprovalNeeded } from '@/features/approvals/ApprovalNeeded'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { AccountPicker } from './AccountPicker'
import { useAccounts, useJournal, useJournals, usePostJournal, useReverseJournal, type JournalInput } from './queries'

const TYPES: Record<string, string> = { general: 'General', opening: 'Opening balance', adjustment: 'Adjustment', reversal: 'Reversal', system: 'From a document' }

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useJournal(id)
  const ws = useWorkspace()
  const accounts = useAccounts(ws.company?.id)
  const perms = useSession((s) => s.me?.permissions ?? [])
  const reverse = useReverseJournal(id)
  const flash = useFlash()
  const [reversing, setReversing] = useState(false)
  const name = (aid: string): string => { const a = accounts.data?.find((x) => x.id === aid); return a ? `${a.code} · ${a.name}` : '' }
  const j = q.data
  const schema = z.object({ postingDate: z.string().min(1, 'Required'), reason: z.string().trim().min(1, 'A reason is required').max(300) })
  return (
    <Drawer title={j?.entryNo ?? 'Journal'} onClose={onClose} width={680}>
      {q.isPending ? <Spinner /> : !j ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{formatDate(j.postingDate)} · {TYPES[j.journalType] ?? j.journalType} · {j.description}</p>
          {j.reversalReason ? <Alert tone="info">This reverses an earlier entry: {j.reversalReason}</Alert> : null}
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Account</th><th className="py-1">Note</th><th className="num py-1 text-right">Debit</th><th className="num py-1 text-right">Credit</th></tr></thead>
            <tbody>
              {j.lines.map((l) => <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{name(l.accountId)}</td><td className="py-1.5 text-muted">{l.description ?? ''}</td><td className="num py-1.5 text-right">{Number(l.debit) ? formatInr(l.debit, { symbol: false }) : ''}</td><td className="num py-1.5 text-right">{Number(l.credit) ? formatInr(l.credit, { symbol: false }) : ''}</td></tr>)}
              <tr className="border-t border-line font-medium"><td className="py-1.5" colSpan={2}>Total</td><td className="num py-1.5 text-right">{formatInr(j.totalDebit, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(j.totalCredit, { symbol: false })}</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-muted">An entry is never edited or deleted. To correct one, reverse it and post it again.</p>
          {can(perms, 'accounting:reverse') && j.journalType !== 'reversal' && !reversing ? <Button variant="secondary" className="self-start" onClick={() => setReversing(true)}>Reverse this entry</Button> : null}
          {reversing ? (
            <SimpleForm schema={schema} defaults={{ postingDate: todayIso(), reason: '' }} fields={['postingDate', 'reason']} label="Post reversal" submit={async (v) => { const r = await reverse.mutateAsync(v); flash.show(`${r.entryNo} reverses ${j.entryNo}.`); onClose() }}>
              {({ register, errors }) => (<><TextField label="Reversal date" type="date" error={errors.postingDate?.message as string | undefined} {...register('postingDate')} /><TextField label="Reason" error={errors.reason?.message as string | undefined} {...register('reason')} /></>)}
            </SimpleForm>
          ) : null}
        </div>
      )}
    </Drawer>
  )
}

export function JournalsPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'accounting:post')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const list = useJournals(ws.company?.id, { ...(type ? { journalType: type } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })
  const [open, setOpen] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<JournalHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'entryNo', size: 150 }, { header: 'Date', accessorFn: (j) => formatDate(j.postingDate), size: 100 }, { header: 'Type', accessorFn: (j) => TYPES[j.journalType] ?? j.journalType, size: 140 },
    { header: 'Description', accessorKey: 'description', size: 380 }, { header: 'Amount', accessorFn: (j) => formatInr(j.totalDebit), size: 130, meta: { align: 'right' } },
  ], [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">No company yet. <Link to="/setup" className="underline">Set up your business</Link>.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Journal entries</h1>{canPost ? <Button onClick={() => void navigate({ to: '/accounting/journals/new' })}><Plus className="size-4" aria-hidden /> New journal</Button> : null}</div>
      <Toolbar>
        <div className="w-48"><SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All' }, ...Object.entries(TYPES).map(([value, label]) => ({ value, label }))]} /></div>
        <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(j) => j.id} onOpen={(j) => setOpen(j.id)} empty="No entries yet." height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {open ? <Detail id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

// ---- the editor -------------------------------------------------------------------------------------------------------------
interface JLine { key: string; account: LedgerAccount | null; debit: string; credit: string; note: string }
let n = 0
const blank = (): JLine => ({ key: `j${++n}`, account: null, debit: '', credit: '', note: '' })
const isBlank = (l: JLine): boolean => l.account === null && l.debit === '' && l.credit === ''

export function buildJournalBody(h: { companyId: string; date: string; description: string; journalType: string }, lines: JLine[]): JournalInput | null {
  const filled = lines.filter((l) => !isBlank(l))
  if (filled.length < 2 || !h.description.trim() || !h.date) return null
  const out: JournalInput['lines'] = []
  for (const l of filled) {
    const d = l.debit.trim(); const c = l.credit.trim()
    if (!l.account || (d !== '') === (c !== '')) return null
    const amount = d || c
    if (!isValid(amount) || compare(amount, '0') <= 0) return null
    out.push({ accountId: l.account.id, ...(d ? { debit: d } : { credit: c }), ...(l.note.trim() ? { description: l.note.trim() } : {}) })
  }
  const debit = sum(filled.map((l) => l.debit.trim()).filter(Boolean))
  const credit = sum(filled.map((l) => l.credit.trim()).filter(Boolean))
  if (compare(debit, credit) !== 0) return null
  return { companyId: h.companyId, postingDate: h.date, journalType: h.journalType as 'general', description: h.description.trim(), lines: out }
}

export function JournalEditorPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const flash = useFlash()
  const post = usePostJournal()
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [type, setType] = useState('general')
  const [lines, setLines] = useState<JLine[]>([blank(), blank()])
  const [error, setError] = useState<unknown>(null)
  const filled = lines.filter((l) => !isBlank(l))
  const debit = sum(filled.map((l) => l.debit.trim()).filter((v) => isValid(v) && v !== ''))
  const credit = sum(filled.map((l) => l.credit.trim()).filter((v) => isValid(v) && v !== ''))
  const diff = sub(debit, credit)
  const body = useMemo(() => (ws.company ? buildJournalBody({ companyId: ws.company.id, date, description, journalType: type }, lines) : null), [ws.company, date, description, type, lines])
  const bodyJson = JSON.stringify(body)
  const key = useMemo(() => crypto.randomUUID(), [bodyJson]) // eslint-disable-line react-hooks/exhaustive-deps
  const submitRef = useRef<() => void>(() => undefined)
  const patch = (k: string, p: Partial<JLine>): void => setLines(lines.map((l) => (l.key === k ? { ...l, ...p } : l)))

  async function submit() {
    if (!body) return
    setError(null)
    try { const j = await post.mutateAsync({ body, key }); flash.show(`${j.entryNo} posted.`); await navigate({ to: '/accounting/journals' }) } catch (e) { setError(e) }
  }
  submitRef.current = () => { void submit() }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); submitRef.current() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const message = error instanceof ApiError && error.code !== 'approval_required' ? `${error.message}${error.requestId ? ` (reference ${error.requestId})` : ''}` : null
  const balanced = compare(debit, credit) === 0 && toUnits(debit) > 0n
  const cell = 'h-8 w-full rounded border border-transparent bg-transparent px-2 text-sm outline-none hover:border-line focus:border-brand focus:bg-surface focus:ring-1 focus:ring-brand/40'
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">New journal entry</h1><span className="text-xs text-muted">Ctrl+S posts when the entry balances</span></div>
      <Card>
        <div className="grid grid-cols-4 gap-4">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <SelectField label="Kind" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: 'general', label: 'General' }, { value: 'adjustment', label: 'Adjustment' }, { value: 'opening', label: 'Opening balance' }]} />
          <div className="col-span-2"><TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus /></div>
        </div>
      </Card>
      <div className="overflow-visible rounded-lg border border-line bg-surface" role="group" aria-label="Journal lines">
        <div className="grid grid-cols-[2fr_1.4fr_1fr_1fr_32px] gap-1 border-b border-line bg-canvas px-2 py-1.5 text-xs font-semibold text-muted"><span>Account</span><span>Note</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span /></div>
        {lines.map((l) => (
          <div key={l.key} className="grid grid-cols-[2fr_1.4fr_1fr_1fr_32px] items-center gap-1 border-b border-line/60 px-2 py-1 last:border-0">
            <AccountPicker label="Account" compact value={l.account} onPick={(a) => patch(l.key, { account: a })} />
            <input aria-label="Note" className={cell} value={l.note} onChange={(e) => patch(l.key, { note: e.target.value })} />
            <input aria-label="Debit" inputMode="decimal" className={`${cell} num text-right`} value={l.debit} onChange={(e) => patch(l.key, { debit: e.target.value, ...(e.target.value ? { credit: '' } : {}) })} />
            <input aria-label="Credit" inputMode="decimal" className={`${cell} num text-right`} value={l.credit} onChange={(e) => patch(l.key, { credit: e.target.value, ...(e.target.value ? { debit: '' } : {}) })} />
            <button type="button" aria-label="Remove line" className="grid size-7 place-items-center rounded text-muted hover:bg-canvas hover:text-bad" onClick={() => setLines(lines.length > 2 ? lines.filter((x) => x.key !== l.key) : lines.map((x) => (x.key === l.key ? blank() : x)))}><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
      <Button variant="ghost" className="self-start" onClick={() => setLines([...lines, blank()])}>+ Add line</Button>
      <div className="grid grid-cols-[1fr_320px] gap-4">
        <div className="flex flex-col gap-2">
          <ApprovalNeeded error={error} request={body && ws.company ? { companyId: ws.company.id, documentType: 'journal', payload: body as unknown as Record<string, unknown> } : null} />
          {message ? <Alert>{message}</Alert> : null}
        </div>
        <Card>
          <dl className="flex flex-col gap-1 text-sm" aria-label="Journal totals">
            <div className="flex justify-between"><dt className="text-muted">Debits</dt><dd className="num">{formatInr(debit)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Credits</dt><dd className="num">{formatInr(credit)}</dd></div>
            <div className={`mt-1 flex justify-between border-t border-line pt-2 font-semibold ${balanced ? 'text-good' : 'text-bad'}`}><dt>{balanced ? 'Balanced' : 'Difference'}</dt><dd className="num">{balanced ? '' : formatInr(fromUnits(toUnits(diff) < 0n ? -toUnits(diff) : toUnits(diff)))}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-muted">Control accounts (receivables, payables, stock, tax) are not offered: documents post to them.</p>
          <Button className="mt-3 w-full" busy={post.isPending} disabled={!body} onClick={() => void submit()}>Post entry</Button>
        </Card>
      </div>
    </div>
  )
}
