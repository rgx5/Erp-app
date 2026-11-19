import { useMemo, useState } from 'react'
import { z } from 'zod'
import type { ColumnDef } from '@tanstack/react-table'
import type { LedgerAccount, PayrollRunHeader, Payslip } from '@/api/schemas'
import { ApiError } from '@/api/errors'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { AccountPicker } from '@/features/accounting/AccountPicker'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { bridge } from '@/bridge'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useCancelRun, useCreateRun, useEmployees, useInputs, usePayRun, usePutInput, useRun, useRuns } from './queries'
import { payslipHtml } from './payslipHtml'

type Tab = 'runs' | 'inputs'
const STATUS: Record<string, string> = { posted: 'Posted, not paid', paid: 'Paid', cancelled: 'Cancelled' }
const msg = (e: unknown, f: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : f)
const thisMonth = (): string => todayIso().slice(0, 7)

function Inputs({ companyId }: { companyId: string }) {
  const perms = useSession((s) => s.me?.permissions ?? [])
  const [period, setPeriod] = useState(thisMonth())
  const emps = useEmployees(companyId, 'active')
  const inputs = useInputs(companyId, period)
  const put = usePutInput()
  const flash = useFlash()
  const [draft, setDraft] = useState<Record<string, { lop: string; bonus: string; other: string; units: string }>>({})
  const canProcess = can(perms, 'payroll:process')
  const row = (id: string) => draft[id] ?? (() => { const i = inputs.data?.find((x) => x.employeeId === id); return { lop: i ? String(Number(i.lopDays)) : '0', bonus: i ? String(Number(i.bonus)) : '0', other: i ? String(Number(i.otherDeduction)) : '0', units: i?.unitsWorked ? String(Number(i.unitsWorked)) : '' } })()
  const cell = 'h-8 w-24 rounded border border-line bg-surface px-2 text-right text-sm'
  return (
    <div className="flex flex-col gap-3">
      <Toolbar><div className="w-44"><TextField label="Month" type="month" value={period} onChange={(e) => { setPeriod(e.target.value); setDraft({}) }} /></div></Toolbar>
      <p className="text-sm text-muted">What changes this month: days of unpaid leave, bonus, other recoveries, and units worked for people paid by the day or hour (days or hours). Anyone not listed is paid in full.</p>
      {emps.isPending || inputs.isPending ? <Spinner /> : (
        <div className="overflow-auto rounded-lg border border-line bg-surface"><table className="w-full text-sm" aria-label="Monthly inputs"><thead><tr className="bg-canvas text-left text-xs text-muted"><th className="p-2">Person</th><th className="p-2 text-right">Unpaid leave days</th><th className="p-2 text-right">Bonus</th><th className="p-2 text-right">Other deduction</th><th className="p-2 text-right">Days / hours worked</th><th /></tr></thead>
          <tbody>{emps.rows.map((e) => { const r = row(e.id); const set = (p: Partial<typeof r>) => setDraft({ ...draft, [e.id]: { ...r, ...p } }); return (
            <tr key={e.id} className="border-t border-line/60"><td className="p-2">{e.fullName}</td>
              <td className="p-2 text-right"><input aria-label={`Unpaid leave days for ${e.fullName}`} className={cell} value={r.lop} onChange={(x) => set({ lop: x.target.value })} /></td>
              <td className="p-2 text-right"><input aria-label={`Bonus for ${e.fullName}`} className={cell} value={r.bonus} onChange={(x) => set({ bonus: x.target.value })} /></td>
              <td className="p-2 text-right"><input aria-label={`Other deduction for ${e.fullName}`} className={cell} value={r.other} onChange={(x) => set({ other: x.target.value })} /></td>
              <td className="p-2 text-right"><input aria-label={`Units worked by ${e.fullName}`} className={cell} disabled={e.payBasis === 'monthly'} value={r.units} onChange={(x) => set({ units: x.target.value })} /></td>
              <td className="p-2 text-right">{canProcess ? <Button variant="ghost" aria-label={`Save ${e.fullName}`} onClick={async () => { try { await put.mutateAsync({ employeeId: e.id, period, body: { lopDays: r.lop || '0', bonus: r.bonus || '0', otherDeduction: r.other || '0', ...(r.units ? { unitsWorked: r.units } : {}) } }); flash.show(`${e.fullName}: saved for ${period}.`) } catch (x) { flash.show(msg(x, 'Could not save.')) } }}>Save</Button> : null}</td></tr>) })}</tbody></table></div>)}
    </div>
  )
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace()
  const q = useRun(id)
  const run = q.data
  const perms = useSession((s) => s.me?.permissions ?? [])
  const pay = usePayRun(id); const cancel = useCancelRun(id)
  const flash = useFlash()
  const [mode, setMode] = useState<null | 'pay' | 'cancel'>(null)
  const [from, setFrom] = useState<LedgerAccount | null>(null)
  const [date, setDate] = useState(todayIso())
  const [problem, setProblem] = useState<string | null>(null)
  const [slip, setSlip] = useState<Payslip | null>(null)
  if (!run) return <Drawer title="Payroll run" onClose={onClose} width={860}>{q.isPending ? <Spinner /> : <Alert>{q.error?.message ?? 'Not found.'}</Alert>}</Drawer>
  const t = (k: keyof PayrollRunHeader): string => formatInr(String(run[k]))
  const printSlip = async (p: Payslip) => { try { await bridge.document.savePdf(payslipHtml(p, ws.company?.legalName ?? '', run.payDate), `payslip-${p.employeeNo}-${p.period}`) } catch (e) { setProblem(msg(e, 'Could not create the payslip.')) } }
  return (
    <Drawer title={`${run.runNo} · ${run.period}`} onClose={onClose} width={860}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{STATUS[run.status] ?? run.status} · pay date {formatDate(run.payDate)}{run.paidOn ? ` · paid ${formatDate(run.paidOn)}` : ''}{run.cancelReason ? ` · cancelled: ${run.cancelReason}` : ''}</p>
        <dl className="grid grid-cols-4 gap-3 text-sm" aria-label="Run totals">{([['Gross pay', 'grossTotal'], ['Deductions', 'employeeDeductions'], ['Net pay', 'netTotal'], ['Employer cost', 'employerCostTotal'], ['PF', 'pfTotal'], ['ESI', 'esiTotal'], ['Professional tax', 'ptTotal'], ['TDS', 'tdsTotal']] as [string, keyof PayrollRunHeader][]).map(([k, f]) => <div key={f}><dt className="text-xs text-muted">{k}</dt><dd className="num font-medium">{t(f)}</dd></div>)}</dl>
        {problem ? <Alert>{problem}</Alert> : null}
        <table className="w-full text-sm" aria-label="Payslips in the run"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Person</th><th className="py-1 text-right">Gross</th><th className="py-1 text-right">PF</th><th className="py-1 text-right">ESI</th><th className="py-1 text-right">PT</th><th className="py-1 text-right">TDS</th><th className="py-1 text-right">Net</th><th /></tr></thead>
          <tbody>{run.payslips.map((p) => <tr key={p.id} className="border-t border-line/60"><td className="py-1.5">{p.employeeName}</td><td className="num py-1.5 text-right">{formatInr(p.gross, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(p.pfEmployee, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(p.esiEmployee, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(p.professionalTax, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(p.tds, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(p.net, { symbol: false })}</td><td className="py-1.5 text-right"><Button variant="ghost" aria-label={`Payslip ${p.employeeName}`} onClick={() => setSlip(p)}>Payslip</Button></td></tr>)}</tbody></table>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => download(`payroll-${run.period}.csv`, toCsv(['Employee no', 'Name', 'Gross', 'PF employee', 'PF employer', 'ESI employee', 'ESI employer', 'Professional tax', 'TDS', 'Other deductions', 'Net'], run.payslips.map((p) => [p.employeeNo, p.employeeName, p.gross, p.pfEmployee, p.pfEmployer, p.esiEmployee, p.esiEmployer, p.professionalTax, p.tds, p.otherDeductions, p.net])))}>Export CSV</Button>
          {run.status === 'posted' && can(perms, 'payroll:process') ? <Button onClick={() => setMode('pay')}>Mark as paid</Button> : null}
          {run.status !== 'cancelled' && can(perms, 'payroll:cancel') ? <Button variant="ghost" onClick={() => setMode('cancel')}>Cancel run</Button> : null}
        </div>
        {mode === 'pay' ? (
          <Card title="Pay the net salaries"><div className="flex flex-col gap-3"><TextField label="Paid on" type="date" value={date} onChange={(e) => setDate(e.target.value)} /><AccountPicker label="Paid from (bank or cash)" value={from} filter={(a) => a.type === 'asset'} onPick={setFrom} />
            <Button busy={pay.isPending} disabled={!from} onClick={async () => { if (!from) return; setProblem(null); try { await pay.mutateAsync({ date, paidFromAccountId: from.id }); flash.show(`${run.runNo} paid.`); setMode(null) } catch (e) { setProblem(msg(e, 'Could not record the payment.')) } }}>Record payment</Button></div></Card>) : null}
        {mode === 'cancel' ? (
          <Card title="Cancel this run"><SimpleForm schema={z.object({ date: z.string().min(1), reason: z.string().trim().min(2, 'Give a reason').max(300) })} defaults={{ date: todayIso(), reason: '' }} fields={['date', 'reason']} label="Cancel run" submit={async (v) => { await cancel.mutateAsync(v); flash.show(`${run.runNo} cancelled.`); setMode(null) }}>
            {({ register, errors }) => (<><TextField label="Date" type="date" {...register('date')} /><TextField label="Reason" error={errors.reason?.message as string | undefined} {...register('reason')} /></>)}</SimpleForm></Card>) : null}
        {slip ? (
          <Drawer title={`Payslip · ${slip.employeeName}`} onClose={() => setSlip(null)} width={520}>
            <div className="flex flex-col gap-3 text-sm" aria-label="Payslip">
              <p className="text-muted">{slip.employeeNo} · {slip.period}{slip.detail.paidDays ? ` · paid days ${slip.detail.paidDays}` : ''}</p>
              <table className="w-full"><tbody>{(slip.detail.earnings ?? []).map((e) => <tr key={e.code}><td className="py-0.5">{e.name}</td><td className="num py-0.5 text-right">{formatInr(e.amount, { symbol: false })}</td></tr>)}
                {Number(slip.detail.bonus ?? 0) ? <tr><td className="py-0.5">Bonus</td><td className="num py-0.5 text-right">{formatInr(slip.detail.bonus ?? '0', { symbol: false })}</td></tr> : null}
                <tr className="border-t border-line font-medium"><td className="py-1">Gross</td><td className="num py-1 text-right">{formatInr(slip.gross, { symbol: false })}</td></tr>
                {([['Provident fund', slip.pfEmployee], ['ESI', slip.esiEmployee], ['Professional tax', slip.professionalTax], ['Income tax (TDS)', slip.tds], ['Other deductions', slip.otherDeductions]] as [string, string][]).filter(([, v]) => Number(v) !== 0).map(([k, v]) => <tr key={k}><td className="py-0.5 text-muted">Less: {k}</td><td className="num py-0.5 text-right">{formatInr(v, { symbol: false })}</td></tr>)}
                <tr className="border-t border-line font-semibold"><td className="py-1">Net pay</td><td className="num py-1 text-right">{formatInr(slip.net, { symbol: false })}</td></tr></tbody></table>
              <Button variant="secondary" className="self-start" onClick={() => void printSlip(slip)}>{window.onesync ? 'Save as PDF' : 'Print'}</Button>
            </div>
          </Drawer>) : null}
      </div>
    </Drawer>
  )
}

export function PayrollRunsPage() {
  const ws = useWorkspace()
  const canProcess = can(useSession((s) => s.me?.permissions ?? []), 'payroll:process')
  const [tab, setTab] = useState<Tab>('runs')
  const list = useRuns(ws.company?.id)
  const create = useCreateRun()
  const flash = useFlash()
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const columns = useMemo<ColumnDef<PayrollRunHeader, unknown>[]>(() => [
    { header: 'Run', accessorKey: 'runNo', size: 150 }, { header: 'Month', accessorKey: 'period', size: 90 }, { header: 'Pay date', accessorFn: (r) => formatDate(r.payDate), size: 100 },
    { header: 'Gross', accessorFn: (r) => formatInr(r.grossTotal), size: 130, meta: { align: 'right' } }, { header: 'Net', accessorFn: (r) => formatInr(r.netTotal), size: 130, meta: { align: 'right' } }, { header: 'Status', accessorFn: (r) => STATUS[r.status] ?? r.status, size: 130 },
  ], [])
  const runSchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, 'Choose a month'), payDate: z.string().min(1, 'Required') })
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const company = ws.company
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Payroll runs</h1>{canProcess ? <Button onClick={() => setAdding(true)}>New payroll run</Button> : null}</div>
      <div role="tablist" className="flex gap-1 border-b border-line">{([['runs', 'Runs'], ['inputs', 'Monthly inputs']] as [Tab, string][]).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'inputs' ? <Inputs companyId={company.id} /> : (<>
        {list.error ? <Alert>{list.error.message}</Alert> : null}
        {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(r) => r.id} onOpen={(r) => setOpen(r.id)} empty="No payroll run yet." height={480} />}</>)}
      {open ? <Detail id={open} onClose={() => setOpen(null)} /> : null}
      {adding ? (
        <Drawer title="New payroll run" onClose={() => setAdding(false)}>
          <p className="mb-3 text-sm text-muted">Calculates everyone&apos;s pay for the month from their salary structure and the monthly inputs, and posts it to the books. Enter the monthly inputs first.</p>
          <SimpleForm schema={runSchema} defaults={{ period: thisMonth(), payDate: todayIso() }} fields={['period', 'payDate']} label="Run payroll" submit={async (v) => { try { const r = await create.mutateAsync({ key: crypto.randomUUID(), body: { companyId: company.id, period: v.period, payDate: v.payDate } }); flash.show(`${r.runNo} posted.`); setAdding(false); setOpen(r.id) } catch (e) { throw new Error(msg(e, 'Could not run payroll.')) } }}>
            {({ register, errors }) => (<><TextField label="Month" type="month" error={errors.period?.message as string | undefined} {...register('period')} /><TextField label="Pay date" type="date" error={errors.payDate?.message as string | undefined} {...register('payDate')} /></>)}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}
