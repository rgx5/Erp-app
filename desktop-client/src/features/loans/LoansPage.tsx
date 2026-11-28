import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ApiError } from '@/api/errors'
import { send } from '@/api/send'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useWorkspace } from '@/features/organization/workspace'
import { useCashAccounts } from '@/features/sales/queries'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, FormActions, SelectField, Spinner, Tag, TextField } from '@/ui/primitives'
import { useDebounced } from '@/ui/hooks'

interface Loan { id: string; direction: 'taken' | 'given'; loanNo: string; name: string; principal: string; annualRate: string; method: string; tenureMonths: number; disbursedOn: string; firstDueOn: string; emi: string; status: string; closedOn: string | null; paidCount: number; outstanding: string; nextDue: string | null; bankAccountId: string }
interface Inst { id: string; no: number; dueDate: string; principal: string; interest: string; emi: string; status: string; paidOn: string | null }
interface Plan { emi: string; totalInterest: string; totalPayable: string; instalments: Array<{ no: number; dueDate: string; principal: string; interest: string; emi: string }> }
const TONE: Record<string, 'good' | 'neutral' | 'bad' | 'warn'> = { active: 'good', closed: 'neutral', cancelled: 'bad' }
const label = (d: 'taken' | 'given') => (d === 'taken' ? 'Loans taken' : 'Loans given')

const useLoans = (companyId: string | undefined, direction: 'taken' | 'given') =>
  useQuery({ queryKey: ['loans', companyId, direction], enabled: Boolean(companyId), queryFn: async () => (await send<{ items: Loan[] }>('GET', '/v1/loans', { query: { companyId, direction } })).items })

function NewLoan({ direction, companyId, onClose }: { direction: 'taken' | 'given'; companyId: string; onClose: () => void }) {
  const qc = useQueryClient(); const go = useNavigate(); const accounts = useCashAccounts(companyId)
  const [name, setName] = useState(''); const [principal, setPrincipal] = useState(''); const [rate, setRate] = useState('0'); const [months, setMonths] = useState('12'); const [method, setMethod] = useState('reducing')
  const [disbursed, setDisbursed] = useState(todayIso()); const [first, setFirst] = useState(''); const [bank, setBank] = useState(''); const [problem, setProblem] = useState<string | null>(null)
  const valid = /^\d{1,14}(\.\d{1,2})?$/.test(principal.trim()) && Number(principal) > 0 && Number(months) >= 1 && Number(rate) >= 0
  const key = useDebounced(JSON.stringify([principal, rate, months, method, first, disbursed]), 350)
  const firstDue = first || (() => { const d = new Date(`${disbursed}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10) })()
  const preview = useQuery({ queryKey: ['loan-preview', key], enabled: valid, queryFn: () => send<Plan>('POST', '/v1/loans/preview', { body: { principal: principal.trim(), annualRate: Number(rate), method, tenureMonths: Number(months), firstDueOn: firstDue } }) })
  const create = useMutation({
    mutationFn: () => send<{ id: string }>('POST', '/v1/loans', { body: { companyId, direction, name: name.trim(), principal: principal.trim(), annualRate: Number(rate), method, tenureMonths: Number(months), disbursedOn: disbursed, ...(first ? { firstDueOn: first } : {}), bankAccountId: bank } }),
    onSuccess: (l) => { void qc.invalidateQueries({ queryKey: ['loans'] }); onClose(); void go({ to: `/accounting/loans/${l.id}` as never }) },
  })
  const taken = direction === 'taken'
  return (
    <Drawer title={taken ? 'Record a loan taken' : 'Record a loan given'} subtitle={taken ? 'Money you borrowed from a bank or a person' : 'Money you lent to a person or a business'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <TextField label={taken ? 'Lender' : 'Borrower'} value={name} onChange={(e) => setName(e.target.value)} placeholder={taken ? 'e.g. HDFC Bank term loan' : 'e.g. Staff advance · Ramesh'} autoFocus />
        <div className="grid grid-cols-2 gap-4"><TextField label="Amount" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} /><TextField label="Interest per year (%)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-4"><TextField label="Months to repay" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /><SelectField label="Interest worked out" value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: 'reducing', label: 'On what is still owed' }, { value: 'flat', label: 'Flat, on the full amount' }]} /></div>
        <div className="grid grid-cols-2 gap-4"><TextField label={taken ? 'Money received on' : 'Money given on'} type="date" value={disbursed} onChange={(e) => setDisbursed(e.target.value)} /><TextField label="First instalment on" type="date" value={first || firstDue} onChange={(e) => setFirst(e.target.value)} /></div>
        <SelectField label={taken ? 'Bank or cash account it came into' : 'Bank or cash account it was paid from'} value={bank} onChange={(e) => setBank(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]} />
        {valid && preview.data ? (
          <div className="border-t border-line pt-3 text-sm">
            <p className="flex justify-between"><span className="text-muted">Monthly instalment</span><b className="num">{formatInr(preview.data.emi)}</b></p>
            <p className="flex justify-between"><span className="text-muted">Total interest</span><span className="num">{formatInr(preview.data.totalInterest)}</span></p>
            <p className="flex justify-between"><span className="text-muted">Total to {taken ? 'repay' : 'receive'}</span><span className="num">{formatInr(preview.data.totalPayable)}</span></p>
          </div>
        ) : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <FormActions><Button disabled={!name.trim() || !valid || !bank} busy={create.isPending} onClick={() => { setProblem(null); create.mutate(undefined, { onError: (e) => setProblem(e instanceof ApiError ? e.message : 'Could not save the loan.') }) }}>Save loan</Button></FormActions>
      </div>
    </Drawer>
  )
}

/** Loans taken (a liability) or given (an asset), with what is still owed and when the next instalment falls due. */
export function LoansPage({ direction }: { direction: 'taken' | 'given' }) {
  const ws = useWorkspace(); const companyId = ws.company?.id; const go = useNavigate()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'loans:post')
  const list = useLoans(companyId, direction); const [adding, setAdding] = useState(false); const rows = useMemo(() => list.data ?? [], [list.data])
  const owed = rows.filter((l) => l.status === 'active').reduce((t, l) => t + Number(l.outstanding), 0)
  const columns = useMemo<ColumnDef<Loan, unknown>[]>(() => [
    { id: 'loan', header: 'Loan', accessorFn: (l) => `${l.loanNo} · ${l.name}`, size: 260 },
    { id: 'amount', header: 'Amount', accessorFn: (l) => formatInr(l.principal), size: 110, meta: { align: 'right' } },
    { id: 'rate', header: 'Interest', accessorFn: (l) => `${Number(l.annualRate)}% a year`, size: 100 },
    { id: 'emi', header: 'Instalment', accessorFn: (l) => formatInr(l.emi), size: 110, meta: { align: 'right' } },
    { id: 'owed', header: direction === 'taken' ? 'Still owed' : 'Still to receive', accessorFn: (l) => formatInr(l.outstanding), size: 120, meta: { align: 'right' } },
    { id: 'next', header: 'Next due', accessorFn: (l) => (l.nextDue ? formatDate(l.nextDue) : ''), size: 100 },
    { id: 'state', header: 'State', size: 90, cell: ({ row }) => <Tag tone={TONE[row.original.status] ?? 'neutral'}>{row.original.status[0]?.toUpperCase() + row.original.status.slice(1)}</Tag> },
  ], [direction])
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><div><h1 className="page-title">{label(direction)}</h1><p className="page-sub">{direction === 'taken' ? 'Money you owe to banks and others, with each instalment split into principal and interest.' : 'Money you have lent, and what is still to come back.'}</p></div>{canPost ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record a loan</Button> : null}</div>
      {rows.length ? <p className="text-sm text-muted">{direction === 'taken' ? 'Total owed' : 'Total to receive'}: <b className="num text-ink">{formatInr(String(owed))}</b></p> : null}
      {list.isPending ? <Spinner /> : <DataTable<Loan> rows={rows} rowKey={(l) => l.id} empty={`No ${label(direction).toLowerCase()} yet.`} columns={columns} onOpen={(l) => void go({ to: `/accounting/loans/${l.id}` as never })} />}
      {adding && companyId ? <NewLoan direction={direction} companyId={companyId} onClose={() => setAdding(false)} /> : null}
    </div>
  )
}

function Step({ loan, inst, mode, onClose }: { loan: Loan; inst?: Inst; mode: 'pay' | 'foreclose' | 'cancel'; onClose: () => void }) {
  const qc = useQueryClient(); const accounts = useCashAccounts(useWorkspace().company?.id)
  const [date, setDate] = useState(todayIso()); const [account, setAccount] = useState(loan.bankAccountId); const [interest, setInterest] = useState('0'); const [reason, setReason] = useState(''); const [problem, setProblem] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: () => mode === 'pay' ? send('POST', `/v1/loans/${loan.id}/instalments/${inst?.no}/pay`, { body: { date, accountId: account } }) : mode === 'foreclose' ? send('POST', `/v1/loans/${loan.id}/foreclose`, { body: { date, accountId: account, interest: interest || '0' } }) : send('POST', `/v1/loans/${loan.id}/cancel`, { body: { date, reason } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['loan', loan.id] }); void qc.invalidateQueries({ queryKey: ['loans'] }); void qc.invalidateQueries({ queryKey: ['position'] }); onClose() },
  })
  const taken = loan.direction === 'taken'
  const title = mode === 'pay' ? `${taken ? 'Pay' : 'Receive'} instalment ${inst?.no}` : mode === 'foreclose' ? 'Close the loan early' : 'Cancel this loan'
  return (
    <Drawer title={title} subtitle={`${loan.loanNo} · ${loan.name}`} onClose={onClose} width={440}>
      <div className="flex flex-col gap-4">
        {mode === 'pay' && inst ? <p className="text-sm text-muted">{formatInr(inst.emi)}: {formatInr(inst.principal)} principal and {formatInr(inst.interest)} interest.</p> : null}
        {mode === 'foreclose' ? <p className="text-sm text-muted">This {taken ? 'pays' : 'receives'} the {formatInr(loan.outstanding)} still outstanding, plus any interest to that day, and ends the schedule.</p> : null}
        {mode === 'cancel' ? <p className="text-sm text-muted">For a loan entered by mistake. The money movement is reversed. Not possible once an instalment has been paid.</p> : null}
        <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {mode !== 'cancel' ? <SelectField label="Bank or cash account" value={account} onChange={(e) => setAccount(e.target.value)} options={(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} /> : null}
        {mode === 'foreclose' ? <TextField label="Interest to that day (if the lender charges any)" inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} /> : null}
        {mode === 'cancel' ? <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <FormActions><Button variant={mode === 'cancel' ? 'danger' : 'primary'} disabled={mode === 'cancel' && !reason.trim()} busy={run.isPending} onClick={() => { setProblem(null); run.mutate(undefined, { onError: (e) => setProblem(e instanceof ApiError ? e.message : 'That did not work.') }) }}>{title}</Button></FormActions>
      </div>
    </Drawer>
  )
}

/** One loan: its terms, what is paid and owed, and every instalment with the next one ready to pay. */
export function LoanDetailPage() {
  const { loanId } = useParams({ from: '/app/accounting/loans/$loanId' })
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'loans:post')
  const q = useQuery({ queryKey: ['loan', loanId], queryFn: () => send<Loan & { instalments: Inst[] }>('GET', `/v1/loans/${loanId}`) })
  const [step, setStep] = useState<{ mode: 'pay' | 'foreclose' | 'cancel'; inst?: Inst } | null>(null)
  useEffect(() => { document.title = q.data ? `${q.data.loanNo} · OneSyncERP` : 'OneSyncERP' }, [q.data])
  if (q.isPending) return <Spinner />
  if (!q.data) return <Alert>That loan could not be found.</Alert>
  const l = q.data; const next = l.instalments.find((i) => i.status === 'due'); const taken = l.direction === 'taken'
  const paid = l.instalments.filter((i) => i.status === 'paid')
  const interestPaid = paid.reduce((t, i) => t + Number(i.interest), 0)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="page-title">{l.name}</h1><p className="page-sub">{l.loanNo} · {taken ? 'Loan taken' : 'Loan given'} on {formatDate(l.disbursedOn)} · <Tag tone={TONE[l.status] ?? 'neutral'}>{l.status[0]?.toUpperCase() + l.status.slice(1)}</Tag></p></div>
        {canPost && l.status === 'active' ? <div className="flex gap-2">{next ? <Button onClick={() => setStep({ mode: 'pay', inst: next })}>{taken ? 'Pay' : 'Receive'} instalment {next.no}</Button> : null}<Button variant="secondary" onClick={() => setStep({ mode: 'foreclose' })}>Close early</Button>{paid.length === 0 ? <Button variant="ghost" onClick={() => setStep({ mode: 'cancel' })}>Cancel loan</Button> : null}</div> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Amount</dt><dd className="num text-base font-semibold">{formatInr(l.principal)}</dd></div>
        <div><dt className="text-muted">{taken ? 'Still owed' : 'Still to receive'}</dt><dd className="num text-base font-semibold">{formatInr(l.outstanding)}</dd></div>
        <div><dt className="text-muted">Instalment</dt><dd className="num text-base font-semibold">{formatInr(l.emi)} <span className="text-xs font-normal text-muted">× {l.tenureMonths}</span></dd></div>
        <div><dt className="text-muted">Interest {taken ? 'paid' : 'earned'} so far</dt><dd className="num text-base font-semibold">{formatInr(String(interestPaid))}</dd></div>
        <div><dt className="text-muted">Rate</dt><dd>{Number(l.annualRate)}% a year, {l.method === 'flat' ? 'flat' : 'on the balance'}</dd></div>
        <div><dt className="text-muted">Next due</dt><dd>{next ? formatDate(next.dueDate) : '—'}</dd></div>
      </dl>
      <h2 className="text-sm font-semibold">Repayment schedule</h2>
      <DataTable<Inst> rows={l.instalments} rowKey={(i) => i.id} empty="No instalments."
        columns={[
          { id: 'no', header: '#', accessorKey: 'no', size: 50 }, { id: 'due', header: 'Due', accessorFn: (i) => formatDate(i.dueDate), size: 100 },
          { id: 'p', header: 'Principal', accessorFn: (i) => formatInr(i.principal), size: 110, meta: { align: 'right' } }, { id: 'i', header: 'Interest', accessorFn: (i) => formatInr(i.interest), size: 100, meta: { align: 'right' } },
          { id: 'e', header: 'Instalment', accessorFn: (i) => formatInr(i.emi), size: 110, meta: { align: 'right' } },
          { id: 'st', header: 'State', size: 110, cell: ({ row }) => { const i = row.original; return <Tag tone={i.status === 'paid' ? 'good' : i.status === 'waived' ? 'neutral' : i.dueDate < todayIso() ? 'bad' : 'warn'}>{i.status === 'paid' ? `Paid ${i.paidOn ? formatDate(i.paidOn) : ''}` : i.status === 'waived' ? 'Closed early' : i.dueDate < todayIso() ? 'Overdue' : 'Due'}</Tag> } },
        ] as ColumnDef<Inst, unknown>[]} />
      {step ? <Step loan={l} {...(step.inst ? { inst: step.inst } : {})} mode={step.mode} onClose={() => setStep(null)} /> : null}
    </div>
  )
}
