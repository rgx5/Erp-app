import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { send } from '@/api/send'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { financialYearStart } from '@/domain/india'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useWorkspace } from '@/features/organization/workspace'
import { useCashAccounts } from '@/features/sales/queries'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, FormActions, SelectField, Spinner, Tag, TextField } from '@/ui/primitives'
import { useTcsSections, type TcsSection } from './queries'

interface Row { id: string; invoiceNo: string; invoiceDate: string; customerName: string; pan: string | null; section: string; rate: string; base: string; amount: string; status: string; panMissing: boolean }
interface Register { items: Row[]; totals: { collected: string; deposited: string; pending: string; invoices: number; withoutPan: number } }
interface Deposit { id: string; periodFrom: string; periodTo: string; amount: string; depositedOn: string; challanNo: string | null; notes: string | null }
const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'That did not work. Try again.')

function DepositDrawer({ companyId, from, to, pending, onClose }: { companyId: string; from: string; to: string; pending: string; onClose: () => void }) {
  const qc = useQueryClient(); const accounts = useCashAccounts(companyId)
  const [amount, setAmount] = useState(Number(pending) > 0 ? String(Number(pending)) : ''); const [date, setDate] = useState(todayIso()); const [challan, setChallan] = useState(''); const [bank, setBank] = useState(''); const [problem, setProblem] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => send('POST', '/v1/tcs/deposits', { body: { companyId, periodFrom: from, periodTo: to, amount: amount.trim(), depositedOn: date, ...(challan.trim() ? { challanNo: challan.trim() } : {}), bankAccountId: bank } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tcs'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }); onClose() },
  })
  const valid = /^\d{1,14}(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0
  return (
    <Drawer title="Record TCS deposit" subtitle={`Tax collected ${formatDate(from)} to ${formatDate(to)}`} onClose={onClose} width={440}>
      <div className="flex flex-col gap-4">
        <TextField label="Amount deposited" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        <div className="grid grid-cols-2 gap-4"><TextField label="Deposited on" type="date" value={date} onChange={(e) => setDate(e.target.value)} /><TextField label="Challan number" value={challan} onChange={(e) => setChallan(e.target.value)} /></div>
        <SelectField label="Paid from" value={bank} onChange={(e) => setBank(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]} />
        {problem ? <Alert>{problem}</Alert> : null}
        <FormActions><Button disabled={!valid || !bank} busy={save.isPending} onClick={() => { setProblem(null); save.mutate(undefined, { onError: (e) => setProblem(msg(e)) }) }}>Record deposit</Button></FormActions>
      </div>
    </Drawer>
  )
}

function SectionsDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient(); const sections = useTcsSections()
  const [code, setCode] = useState(''); const [description, setDescription] = useState(''); const [rate, setRate] = useState(''); const [problem, setProblem] = useState<string | null>(null)
  const done = () => void qc.invalidateQueries({ queryKey: ['tcs-sections'] })
  const add = useMutation({ mutationFn: () => send('POST', '/v1/tcs/sections', { body: { code: code.trim(), description: description.trim(), rate: rate.trim() } }), onSuccess: () => { setCode(''); setDescription(''); setRate(''); done() } })
  const edit = useMutation({ mutationFn: (v: { id: string; rate?: string; status?: string }) => send('PATCH', `/v1/tcs/sections/${v.id}`, { body: { ...(v.rate ? { rate: v.rate } : {}), ...(v.status ? { status: v.status } : {}) } }), onSuccess: done })
  return (
    <Drawer title="TCS sections and rates" subtitle="The sections you can collect under. Confirm the rates with your accountant." onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        {sections.isPending ? <Spinner /> : (sections.data ?? []).map((x: TcsSection) => (
          <div key={x.id} className="flex items-center gap-3 border-b border-line pb-2 text-sm">
            <div className="min-w-0 flex-1"><b>{x.code}</b><p className="truncate text-muted">{x.description}</p></div>
            <input aria-label={`Rate for ${x.code}`} className="h-8 w-16 rounded border border-line px-2 text-right" defaultValue={Number(x.rate)} onBlur={(e) => { if (e.target.value.trim() && Number(e.target.value) !== Number(x.rate)) edit.mutate({ id: x.id, rate: e.target.value.trim() }) }} />%
            <Button variant="ghost" onClick={() => edit.mutate({ id: x.id, status: x.status === 'active' ? 'inactive' : 'active' })}>{x.status === 'active' ? 'Turn off' : 'Turn on'}</Button>
          </div>
        ))}
        <h3 className="text-sm font-semibold">Add a section</h3>
        <div className="grid grid-cols-3 gap-3"><TextField label="Code" value={code} onChange={(e) => setCode(e.target.value)} /><div className="col-span-1"><TextField label="Rate (%)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div><div className="col-span-3"><TextField label="What it is for" value={description} onChange={(e) => setDescription(e.target.value)} /></div></div>
        {problem ? <Alert>{problem}</Alert> : null}
        <FormActions><Button disabled={!code.trim() || !description.trim() || !/^\d{1,3}(\.\d{1,4})?$/.test(rate.trim())} busy={add.isPending} onClick={() => { setProblem(null); add.mutate(undefined, { onError: (e) => setProblem(msg(e)) }) }}>Add section</Button></FormActions>
      </div>
    </Drawer>
  )
}

/** Tax collected at source on sales: what was collected, what has been deposited, and what is still to pay. */
export function TcsPage() {
  const ws = useWorkspace(); const companyId = ws.company?.id
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'tcs:manage')
  const [from, setFrom] = useState(financialYearStart(todayIso())); const [to, setTo] = useState(todayIso())
  const [deposit, setDeposit] = useState(false); const [sections, setSections] = useState(false)
  const reg = useQuery({ queryKey: ['tcs', 'register', companyId, from, to], enabled: Boolean(companyId), queryFn: () => send<Register>('GET', '/v1/tcs/register', { query: { companyId, from, to } }) })
  const deps = useQuery({ queryKey: ['tcs', 'deposits', companyId], enabled: Boolean(companyId), queryFn: async () => (await send<{ items: Deposit[] }>('GET', '/v1/tcs/deposits', { query: { companyId } })).items })
  const rows = useMemo(() => reg.data?.items ?? [], [reg.data])
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => [
    { id: 'invoice', header: 'Invoice', accessorFn: (r) => `${r.invoiceNo} · ${formatDate(r.invoiceDate)}`, size: 190 },
    { id: 'customer', header: 'Customer', accessorFn: (r) => r.customerName, size: 210 },
    { id: 'pan', header: 'PAN', size: 120, cell: ({ row }) => (row.original.pan ? row.original.pan : <Tag tone="warn">Missing</Tag>) },
    { id: 'section', header: 'Section', accessorFn: (r) => `${r.section} @ ${Number(r.rate)}%`, size: 220 },
    { id: 'base', header: 'On', accessorFn: (r) => formatInr(r.base), size: 110, meta: { align: 'right' } },
    { id: 'amount', header: 'TCS', accessorFn: (r) => formatInr(r.amount), size: 100, meta: { align: 'right' } },
    { id: 'state', header: 'State', size: 90, cell: ({ row }) => <Tag tone={row.original.status === 'posted' ? 'good' : 'bad'}>{row.original.status === 'posted' ? 'Counted' : 'Cancelled'}</Tag> },
  ], [])
  const t = reg.data?.totals
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="page-title">TCS register</h1><p className="page-sub">Tax collected at source on your sales, and what you have deposited with the government</p></div>
        <div className="flex items-end gap-2">
          <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          {canManage ? <Button variant="ghost" onClick={() => setSections(true)}>Sections and rates</Button> : null}
          {canManage ? <Button onClick={() => setDeposit(true)}>Record deposit</Button> : null}
        </div>
      </div>
      {t ? (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Collected</dt><dd className="num text-base font-semibold">{formatInr(t.collected)}</dd></div>
          <div><dt className="text-muted">Deposited</dt><dd className="num text-base font-semibold">{formatInr(t.deposited)}</dd></div>
          <div><dt className="text-muted">Still to deposit</dt><dd className="num text-base font-semibold">{formatInr(t.pending)}</dd></div>
          <div><dt className="text-muted">Invoices</dt><dd className="text-base font-semibold">{t.invoices}</dd></div>
        </dl>
      ) : null}
      {t && t.withoutPan > 0 ? <Alert>{t.withoutPan} invoice{t.withoutPan === 1 ? '' : 's'} {t.withoutPan === 1 ? 'is' : 'are'} for customers with no PAN. TCS can be due at a higher rate when the buyer has no PAN, so add it to their record.</Alert> : null}
      {reg.isPending ? <Spinner /> : <DataTable<Row> rows={rows} rowKey={(r) => r.id} empty="No TCS collected in this period." columns={columns} />}
      <h2 className="text-sm font-semibold">Deposits</h2>
      <DataTable<Deposit> rows={deps.data ?? []} rowKey={(d) => d.id} empty="No deposits recorded yet." columns={[
        { id: 'on', header: 'Deposited', accessorFn: (d) => formatDate(d.depositedOn), size: 120 },
        { id: 'period', header: 'For', accessorFn: (d) => `${formatDate(d.periodFrom)} to ${formatDate(d.periodTo)}`, size: 220 },
        { id: 'challan', header: 'Challan', accessorFn: (d) => d.challanNo ?? '', size: 140 },
        { id: 'amount', header: 'Amount', accessorFn: (d) => formatInr(d.amount), size: 120, meta: { align: 'right' } },
      ]} />
      {deposit && companyId && t ? <DepositDrawer companyId={companyId} from={from} to={to} pending={t.pending} onClose={() => setDeposit(false)} /> : null}
      {sections ? <SectionsDrawer onClose={() => setSections(false)} /> : null}
    </div>
  )
}
