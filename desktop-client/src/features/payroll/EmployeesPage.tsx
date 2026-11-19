import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import type { Employee } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { STATES } from '@/domain/india'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, CheckField, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useAddStructure, useComponents, useCreateEmployee, useEmployees, useExitEmployee, usePayslips, useStructures, useUpdateEmployee } from './queries'

const BASIS: Record<string, string> = { monthly: 'Monthly salary', daily: 'Paid by the day', hourly: 'Paid by the hour' }
const money = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'An amount such as 25000')
const stateOptions = STATES.map((s) => ({ value: s.code, label: s.name }))

const schema = z.object({
  kind: z.string(), fullName: z.string().trim().min(1, 'Required').max(120), dateOfJoining: z.string().min(1, 'Required'), stateCode: z.string().length(2), payBasis: z.string(), taxRegime: z.string(),
  pan: z.string().trim().toUpperCase().regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, 'A PAN such as ABCDE1234F'), uan: z.string().trim().max(20), esiNo: z.string().trim().max(20), bankAccountRef: z.string().trim().max(60), tdsRatePercent: z.string(),
  pfApplicable: z.boolean(), esiApplicable: z.boolean(), ptApplicable: z.boolean(),
}).refine((v) => v.kind === 'employee' || v.payBasis !== 'monthly' || /^\d{1,2}(\.\d{1,4})?$/.test(v.tdsRatePercent), { path: ['tdsRatePercent'], message: 'A contract worker needs a TDS rate (0 for none)' })

function Form({ emp, onDone }: { emp?: Employee | undefined; onDone: () => void }) {
  const ws = useWorkspace()
  const create = useCreateEmployee(); const update = useUpdateEmployee()
  const flash = useFlash()
  const body = useMemo(() => crypto.randomUUID(), [])
  return (
    <SimpleForm schema={schema} label={emp ? 'Save' : 'Add person'}
      defaults={{ kind: emp?.kind ?? 'employee', fullName: emp?.fullName ?? '', dateOfJoining: emp?.dateOfJoining ?? todayIso(), stateCode: emp?.stateCode ?? '27', payBasis: emp?.payBasis ?? 'monthly', taxRegime: emp?.taxRegime ?? 'new', pan: emp?.pan ?? '', uan: emp?.uan ?? '', esiNo: emp?.esiNo ?? '', bankAccountRef: emp?.bankAccountRef ?? '', tdsRatePercent: emp?.tdsRatePercent ? String(Number(emp.tdsRatePercent)) : '', pfApplicable: emp?.pfApplicable ?? false, esiApplicable: emp?.esiApplicable ?? false, ptApplicable: emp?.ptApplicable ?? false }}
      fields={['kind', 'fullName', 'dateOfJoining', 'stateCode', 'payBasis', 'taxRegime', 'pan', 'uan', 'esiNo', 'bankAccountRef', 'tdsRatePercent', 'pfApplicable', 'esiApplicable', 'ptApplicable']}
      submit={async (v) => {
        const common = { fullName: v.fullName, stateCode: v.stateCode, payBasis: v.payBasis, taxRegime: v.taxRegime, ...(v.pan ? { pan: v.pan } : {}), ...(v.uan ? { uan: v.uan } : {}), ...(v.esiNo ? { esiNo: v.esiNo } : {}), ...(v.bankAccountRef ? { bankAccountRef: v.bankAccountRef } : {}), ...(v.tdsRatePercent !== '' ? { tdsRatePercent: v.tdsRatePercent } : {}), pfApplicable: v.pfApplicable, esiApplicable: v.esiApplicable, ptApplicable: v.ptApplicable }
        if (emp) await update.mutateAsync({ id: emp.id, body: common })
        else { if (!ws.company) return; await create.mutateAsync({ key: body, body: { companyId: ws.company.id, kind: v.kind, dateOfJoining: v.dateOfJoining, ...common } }) }
        flash.show(emp ? 'Saved.' : 'Person added.'); onDone()
      }}>
      {({ register, errors }) => (<>
        {emp ? null : <SelectField label="Type" options={[{ value: 'employee', label: 'Employee' }, { value: 'contract_worker', label: 'Contract worker' }]} {...register('kind')} />}
        <TextField label="Full name" error={errors.fullName?.message as string | undefined} {...register('fullName')} />
        {emp ? null : <TextField label="Date of joining" type="date" error={errors.dateOfJoining?.message as string | undefined} {...register('dateOfJoining')} />}
        <SelectField label="Works in (decides professional tax)" options={stateOptions} {...register('stateCode')} />
        <SelectField label="Paid" options={Object.entries(BASIS).map(([value, label]) => ({ value, label }))} {...register('payBasis')} />
        <SelectField label="Income-tax regime" options={[{ value: 'new', label: 'New regime' }, { value: 'old', label: 'Old regime' }]} {...register('taxRegime')} />
        <TextField label="PAN" error={errors.pan?.message as string | undefined} {...register('pan')} /><TextField label="UAN" {...register('uan')} /><TextField label="ESI number" {...register('esiNo')} /><TextField label="Bank account (reference only)" hint="Last four digits, never the full number" {...register('bankAccountRef')} />
        <TextField label="TDS rate for contract workers (%)" hint="Flat rate on what they are paid; 0 for none" error={errors.tdsRatePercent?.message as string | undefined} {...register('tdsRatePercent')} />
        <CheckField label="Provident fund applies" {...register('pfApplicable')} /><CheckField label="ESI applies" {...register('esiApplicable')} /><CheckField label="Professional tax applies" {...register('ptApplicable')} />
      </>)}
    </SimpleForm>
  )
}

function Salary({ emp, canManage }: { emp: Employee; canManage: boolean }) {
  const ws = useWorkspace()
  const flash = useFlash()
  const list = useStructures(emp.id)
  const comps = useComponents(ws.company?.id)
  const add = useAddStructure(emp.id)
  const [from, setFrom] = useState(todayIso())
  const [basic, setBasic] = useState('')
  const [chosen, setChosen] = useState<Record<string, string | null>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const active = (comps.data ?? []).filter((c) => c.status === 'active')
  const key = useMemo(() => crypto.randomUUID(), [from, basic, JSON.stringify(chosen)]) // eslint-disable-line react-hooks/exhaustive-deps
  const label = emp.payBasis === 'monthly' ? 'Monthly basic' : emp.payBasis === 'daily' ? 'Basic per day' : 'Basic per hour'
  return (
    <div className="flex flex-col gap-3">
      {list.isPending ? <Spinner /> : list.data?.length === 0 ? <Alert tone="info">No salary structure yet. A person cannot be included in a run without one.</Alert> : (
        <table className="w-full text-sm" aria-label="Salary structures"><thead><tr className="text-left text-xs text-muted"><th className="py-1">From</th><th className="py-1 text-right">Basic</th><th className="py-1">Components</th></tr></thead>
          <tbody>{list.data?.map((s) => <tr key={s.id} className="border-t border-line/60"><td className="py-1.5">{formatDate(s.effectiveFrom)}</td><td className="num py-1.5 text-right">{formatInr(s.basic)}</td><td className="py-1.5 text-muted">{s.lines.map((l) => `${comps.data?.find((c) => c.id === l.componentId)?.code ?? ''}${l.amount ? ` ${formatInr(l.amount)}` : ''}`).join(', ')}</td></tr>)}</tbody></table>)}
      {canManage ? (
        <Card title="Set a new structure">
          <div className="grid grid-cols-2 gap-4"><TextField label="Effective from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><TextField label={label} value={basic} onChange={(e) => setBasic(e.target.value)} /></div>
          {active.length ? <div className="mt-3 flex flex-col gap-2"><span className="text-xs font-medium text-muted">Components</span>{active.map((c) => (
            <div key={c.id} className="flex items-center gap-3 text-sm"><label className="flex w-64 items-center gap-2"><input type="checkbox" aria-label={`Include ${c.code}`} checked={c.id in chosen} onChange={(e) => { const next = { ...chosen }; if (e.target.checked) next[c.id] = c.calculation === 'fixed' ? '' : null; else delete next[c.id]; setChosen(next) }} />{c.code} · {c.name}</label>
              {c.id in chosen && c.calculation === 'fixed' ? <input aria-label={`Amount for ${c.code}`} className="h-8 w-32 rounded border border-line bg-surface px-2 text-right text-sm" placeholder="Amount" value={chosen[c.id] ?? ''} onChange={(e) => setChosen({ ...chosen, [c.id]: e.target.value })} /> : c.calculation === 'percent_of_basic' ? <span className="text-xs text-muted">{Number(c.percent)}% of basic</span> : null}</div>))}</div> : null}
          {problem ? <Alert>{problem}</Alert> : null}
          <Button className="mt-3" busy={add.isPending} disabled={!money.safeParse(basic).success || Number(basic) <= 0} onClick={async () => {
            setProblem(null)
            const lines = Object.entries(chosen).map(([componentId, amount]) => ({ componentId, ...(amount ? { amount } : {}) }))
            if (Object.entries(chosen).some(([id, a]) => active.find((c) => c.id === id)?.calculation === 'fixed' && !money.safeParse(a ?? '').success)) { setProblem('Enter an amount for each fixed component you include.'); return }
            try { await add.mutateAsync({ key, body: { effectiveFrom: from, basic, lines } }); flash.show('Salary structure saved.'); setBasic(''); setChosen({}) } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') }
          }}>Save structure</Button>
        </Card>) : null}
    </div>
  )
}

function Detail({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'payroll:manage')
  const [tab, setTab] = useState<'details' | 'salary' | 'payslips'>('salary')
  const slips = usePayslips(tab === 'payslips' ? emp.id : undefined)
  const exit = useExitEmployee()
  const flash = useFlash()
  const [leaving, setLeaving] = useState(todayIso())
  return (
    <Drawer title={`${emp.employeeNo} · ${emp.fullName}`} onClose={onClose} width={700}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{emp.kind === 'employee' ? 'Employee' : 'Contract worker'} · {BASIS[emp.payBasis]} · joined {formatDate(emp.dateOfJoining)}{emp.dateOfLeaving ? ` · left ${formatDate(emp.dateOfLeaving)}` : ''}</p>
        <div role="tablist" className="flex gap-1 border-b border-line">{([['salary', 'Salary'], ['payslips', 'Payslips'], ['details', 'Details']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(id)}>{label}</button>)}</div>
        {tab === 'salary' ? <Salary emp={emp} canManage={canManage && emp.status === 'active'} /> : null}
        {tab === 'payslips' ? (slips.isPending ? <Spinner /> : slips.data?.length === 0 ? <Alert tone="info">No payslips yet.</Alert> : (
          <table className="w-full text-sm" aria-label="Payslips"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Month</th><th className="py-1 text-right">Gross</th><th className="py-1 text-right">Deductions</th><th className="py-1 text-right">Net</th></tr></thead>
            <tbody>{slips.data?.map((p) => <tr key={p.id} className="border-t border-line/60"><td className="py-1.5">{p.period}</td><td className="num py-1.5 text-right">{formatInr(p.gross)}</td><td className="num py-1.5 text-right">{formatInr(String(Number(p.gross) - Number(p.net)))}</td><td className="num py-1.5 text-right">{formatInr(p.net)}</td></tr>)}</tbody></table>)) : null}
        {tab === 'details' ? (
          <div className="flex flex-col gap-4">
            {canManage ? <Form emp={emp} onDone={onClose} /> : <Alert tone="info">You need the manage right to edit details.</Alert>}
            {canManage && emp.status === 'active' ? <Card title="Leaving"><div className="flex items-end gap-3"><div className="w-44"><TextField label="Last day" type="date" value={leaving} onChange={(e) => setLeaving(e.target.value)} /></div><Button variant="secondary" busy={exit.isPending} onClick={async () => { await exit.mutateAsync({ id: emp.id, dateOfLeaving: leaving }); flash.show(`${emp.fullName} marked as left.`); onClose() }}>Mark as left</Button></div></Card> : null}
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}

export function EmployeesPage() {
  const ws = useWorkspace()
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'payroll:manage')
  const [status, setStatus] = useState('active')
  const list = useEmployees(ws.company?.id, status || undefined)
  const [open, setOpen] = useState<Employee | null>(null)
  const [adding, setAdding] = useState(false)
  const columns = useMemo<ColumnDef<Employee, unknown>[]>(() => [
    { header: 'No.', accessorKey: 'employeeNo', size: 110 }, { header: 'Name', accessorKey: 'fullName', size: 260 }, { header: 'Type', accessorFn: (e) => (e.kind === 'employee' ? 'Employee' : 'Contract worker'), size: 140 },
    { header: 'Paid', accessorFn: (e) => BASIS[e.payBasis] ?? e.payBasis, size: 150 }, { header: 'Joined', accessorFn: (e) => formatDate(e.dateOfJoining), size: 100 }, { header: 'Status', accessorKey: 'status', size: 80 },
  ], [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">People</h1>{canManage ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Add person</Button> : null}</div>
      <Toolbar><div className="w-44"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'active', label: 'Working' }, { value: 'exited', label: 'Left' }, { value: '', label: 'All' }]} /></div></Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(e) => e.id} onOpen={setOpen} empty="No one yet." height={480} />}
      {open ? <Detail emp={open} onClose={() => setOpen(null)} /> : null}
      {adding ? <Drawer title="Add a person" onClose={() => setAdding(false)}><Form onDone={() => setAdding(false)} /></Drawer> : null}
    </div>
  )
}
