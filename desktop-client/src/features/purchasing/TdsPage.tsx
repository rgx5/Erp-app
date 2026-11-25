import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useCashAccounts } from '@/features/sales/queries'
import { send } from '@/features/leads/queries'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { useTdsDeductions, useTdsSections, type TdsDeduction, type TdsSection } from './tds'

const fyStart = (): string => { const d = new Date(); return `${d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1}-04-01` }
const depositSchema = z.object({ depositedOn: z.string().min(1, 'Required'), challanNo: z.string().trim().min(1, 'The challan number is needed').max(40), challanDate: z.string().min(1, 'Required'), bsrCode: z.string().trim().max(10), paidFrom: z.string().min(1, 'Choose the account') })

function DepositDrawer({ rows, companyId, onClose }: { rows: TdsDeduction[]; companyId: string; onClose: () => void }) {
  const qc = useQueryClient(); const flash = useFlash(); const accounts = useCashAccounts(companyId)
  const total = rows.reduce((s, r) => s + Number(r.tdsAmount), 0)
  return (
    <Drawer title={`Record deposit of ${formatInr(String(total))}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Alert tone="info">After paying the tax on the income tax portal (challan ITNS 281), enter the challan details. This posts the payment: it clears TDS payable and takes the money out of the bank.</Alert>
        <SimpleForm schema={depositSchema} defaults={{ depositedOn: todayIso(), challanNo: '', challanDate: todayIso(), bsrCode: '', paidFrom: (accounts.data ?? []).find((a) => a.code === '1120')?.id ?? '' }} fields={['challanNo', 'depositedOn']} label="Record deposit"
          submit={async (v) => { await send('POST', '/v1/tds/deposits', { body: { ids: rows.map((r) => r.id), paidFromAccountId: v.paidFrom, depositedOn: v.depositedOn, challanNo: v.challanNo, challanDate: v.challanDate, ...(v.bsrCode ? { bsrCode: v.bsrCode } : {}) } }); await qc.invalidateQueries({ queryKey: ['tds'] }); flash.show('The deposit was recorded.'); onClose() }}>
          {({ register, errors }) => (<>
            <SelectField label="Paid from" options={[{ value: '', label: 'Choose…' }, ...(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]} error={errors.paidFrom?.message as string | undefined} {...register('paidFrom')} />
            <div className="grid grid-cols-2 gap-3"><TextField label="Paid on" type="date" error={errors.depositedOn?.message as string | undefined} {...register('depositedOn')} /><TextField label="Challan date" type="date" error={errors.challanDate?.message as string | undefined} {...register('challanDate')} /></div>
            <div className="grid grid-cols-2 gap-3"><TextField label="Challan number" error={errors.challanNo?.message as string | undefined} {...register('challanNo')} /><TextField label="BSR code (7 digits)" {...register('bsrCode')} /></div>
          </>)}
        </SimpleForm>
      </div>
    </Drawer>
  )
}

function SectionsCard() {
  const q = useTdsSections(); const qc = useQueryClient(); const flash = useFlash()
  const [edit, setEdit] = useState<Record<string, Partial<TdsSection>>>({}); const [problem, setProblem] = useState<string | null>(null)
  if (q.isPending) return <Spinner />
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold">Sections and rates</h2>
      <p className="mb-3 text-xs text-muted">Starting rates for common payments. Rates and limits change: confirm them with your accountant and edit here. A payment is below the limit when it and the year's earlier payments stay within the limits; without a PAN the rate is at least 20%.</p>
      {problem ? <Alert>{problem}</Alert> : null}
      <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Section</th><th className="py-1">Applies to</th><th className="num py-1 text-right">Rate %</th><th className="num py-1 text-right">Single limit</th><th className="num py-1 text-right">Yearly limit</th><th /></tr></thead>
        <tbody>{(q.data ?? []).map((s) => { const e = { ...s, ...edit[s.code] }; const set = (k: keyof TdsSection) => (ev: { target: { value: string } }) => setEdit((x) => ({ ...x, [s.code]: { ...x[s.code], [k]: ev.target.value } }))
          return <tr key={s.code} className="border-t border-line/60"><td className="py-1.5 font-medium">{s.code}</td><td className="py-1.5">{s.description}</td>
            <td className="py-1 text-right"><input aria-label={`Rate for ${s.code}`} className="num h-8 w-20 rounded border border-line bg-surface px-2 text-right" value={Number(e.rate)} onChange={set('rate')} /></td>
            <td className="py-1 text-right"><input aria-label={`Single limit for ${s.code}`} className="num h-8 w-28 rounded border border-line bg-surface px-2 text-right" value={Number(e.singleLimit)} onChange={set('singleLimit')} /></td>
            <td className="py-1 text-right"><input aria-label={`Yearly limit for ${s.code}`} className="num h-8 w-28 rounded border border-line bg-surface px-2 text-right" value={Number(e.annualLimit)} onChange={set('annualLimit')} /></td>
            <td className="py-1 text-right">{edit[s.code] ? <Button variant="secondary" onClick={async () => { setProblem(null); try { await send('PUT', '/v1/tds/sections', { body: { code: s.code, description: e.description, rate: String(e.rate), singleLimit: String(e.singleLimit), annualLimit: String(e.annualLimit), status: e.status } }); setEdit(({ [s.code]: _x, ...rest }) => rest); await qc.invalidateQueries({ queryKey: ['tds'] }); flash.show(`${s.code} saved.`) } catch (x) { setProblem(x instanceof Error ? x.message : 'Could not save.') } }}>Save</Button> : null}</td></tr> })}</tbody></table>
    </Card>
  )
}

/** Tax deducted from supplier payments: what is waiting to be deposited, what has been, and the working for the quarterly TDS return. */
export function TdsPage() {
  const ws = useWorkspace(); const perms = useSession((s) => s.me?.permissions ?? [])
  const [from, setFrom] = useState(fyStart()); const [to, setTo] = useState(todayIso()); const [status, setStatus] = useState('')
  const q = useTdsDeductions({ from, to, ...(status ? { status } : {}) })
  const [picked, setPicked] = useState<Set<string>>(new Set()); const [depositing, setDepositing] = useState(false)
  const rows = q.data ?? []
  const open = rows.filter((r) => r.status === 'deducted'); const today = todayIso()
  const overdue = open.filter((r) => r.dueDate < today)
  const sum = (xs: TdsDeduction[]): number => xs.reduce((s, r) => s + Number(r.tdsAmount), 0)
  const chosen = rows.filter((r) => picked.has(r.id))
  const toggle = (id: string): void => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const canPost = can(perms, 'payables:post')
  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div><h1 className="page-title">TDS</h1><p className="page-sub">Tax you held back from supplier payments, until it is deposited with the government (by the 7th of the next month).</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['To deposit', sum(open), ''], ['Overdue', sum(overdue), overdue.length ? 'text-bad' : ''], ['Deposited', sum(rows.filter((r) => r.status === 'deposited')), ''], ['Deductions', rows.filter((r) => r.status !== 'cancelled').length, 'count']].map(([l, v, t]) => <div key={l as string} className="rounded-lg border border-line bg-surface px-4 py-3"><p className="text-xs text-muted">{l as string}</p><p className={`num text-lg font-semibold ${t === 'text-bad' ? 'text-bad' : ''}`}>{t === 'count' ? String(v) : formatInr(String(v))}</p></div>)}
      </div>
      <div className="filterbar">
        <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="w-44"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, { value: 'deducted', label: 'To deposit' }, { value: 'deposited', label: 'Deposited' }, { value: 'cancelled', label: 'Cancelled' }]} /></div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => download(`tds-register-${from}-${to}.csv`, toCsv(['Deduction date', 'Supplier', 'PAN', 'Section', 'Payment', 'Amount paid on', 'Rate %', 'TDS', 'Higher rate (no PAN)', 'Status', 'Challan no', 'Challan date', 'Deposited on', 'Due date'], rows.filter((r) => r.status !== 'cancelled').map((r) => [r.deductedOn, r.supplier, r.pan ?? '', r.sectionCode, r.paymentNo, r.baseAmount, String(Number(r.rate)), r.tdsAmount, r.noPanRate ? 'yes' : '', r.status, r.challanNo ?? '', r.challanDate ?? '', r.depositedOn ?? '', r.dueDate])))}>Download for the TDS return</Button>
          {canPost ? <Button disabled={chosen.length === 0 || chosen.some((r) => r.status !== 'deducted')} onClick={() => setDepositing(true)}>Record deposit ({chosen.length})</Button> : null}
        </div>
      </div>
      <Card>
        {q.isPending ? <Spinner /> : q.error ? <Alert>{q.error.message}</Alert> : rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">No TDS deducted in this period. Tick "Deduct TDS" when recording a supplier payment.</p> : (
          <table className="w-full text-sm" aria-label="TDS register"><thead><tr className="text-left text-xs text-muted"><th className="w-8" /><th className="py-1">Date</th><th className="py-1">Supplier</th><th className="py-1">Section</th><th className="py-1">Payment</th><th className="num py-1 text-right">Paid on</th><th className="num py-1 text-right">Rate</th><th className="num py-1 text-right">TDS</th><th className="py-1 pl-3">Status</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-line/60"><td className="py-1.5">{canPost && r.status === 'deducted' ? <input type="checkbox" aria-label={`Choose ${r.paymentNo}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /> : null}</td><td className="py-1.5">{formatDate(r.deductedOn)}</td><td className="py-1.5">{r.supplier}<span className="block text-xs text-muted">{r.pan ?? 'No PAN'}{r.noPanRate ? ' · higher rate' : ''}</span></td><td className="py-1.5">{r.sectionCode}</td><td className="py-1.5">{r.paymentNo}</td><td className="num py-1.5 text-right">{formatInr(r.baseAmount, { symbol: false })}</td><td className="num py-1.5 text-right">{Number(r.rate)}%</td><td className="num py-1.5 text-right font-medium">{formatInr(r.tdsAmount, { symbol: false })}</td>
              <td className="py-1.5 pl-3 text-xs">{r.status === 'deducted' ? <span className={r.dueDate < today ? 'font-medium text-bad' : 'text-warn'}>Deposit by {formatDate(r.dueDate)}</span> : r.status === 'deposited' ? <span className="text-good">Deposited {formatDate(r.depositedOn)} · {r.challanNo}</span> : <span className="text-muted">Cancelled</span>}</td></tr>)}</tbody></table>)}
      </Card>
      {can(perms, 'purchasing:manage') ? <SectionsCard /> : null}
      {depositing && ws.company ? <DepositDrawer rows={chosen} companyId={ws.company.id} onClose={() => { setDepositing(false); setPicked(new Set()) }} /> : null}
    </div>
  )
}
