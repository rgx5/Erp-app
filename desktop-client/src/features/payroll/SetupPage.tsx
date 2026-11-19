import { useState } from 'react'
import { z } from 'zod'
import type { LedgerAccount, SlabRow } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatInr, todayIso } from '@/domain/format'
import { STATES } from '@/domain/india'
import { AccountPicker } from '@/features/accounting/AccountPicker'
import { useAccounts } from '@/features/accounting/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, CheckField, SelectField, Spinner, TextField } from '@/ui/primitives'
import { useComponents, useCreateComponent, usePayrollRules, usePayrollSettings, usePutRates, usePutSlabs, useSavePayrollSettings, useSeedPayrollRules, useUpdateComponent } from './queries'

type Tab = 'accounts' | 'rules' | 'components'
const expense = (a: LedgerAccount) => a.type === 'expense' && a.controlKind === null
const liability = (a: LedgerAccount) => a.type === 'liability' && a.controlKind === null
const statutory = (a: LedgerAccount) => a.type === 'liability' && (a.controlKind === null || a.controlKind === 'tax')
const SLOTS = [
  { key: 'salaryExpenseAccountId', label: 'Salary expense', hint: 'Gross pay and bonus are booked here.', ok: expense },
  { key: 'employerCostAccountId', label: 'Employer contributions expense', hint: 'The employer share of PF and ESI.', ok: expense },
  { key: 'salaryPayableAccountId', label: 'Salary payable', hint: 'Net pay owed to staff until paid.', ok: liability },
  { key: 'pfPayableAccountId', label: 'PF payable', hint: 'Provident fund owed to the fund.', ok: statutory },
  { key: 'esiPayableAccountId', label: 'ESI payable', hint: 'Employees’ state insurance owed.', ok: statutory },
  { key: 'ptPayableAccountId', label: 'Professional tax payable', hint: 'Professional tax owed to the state.', ok: statutory },
  { key: 'tdsPayableAccountId', label: 'TDS on salary payable', hint: 'Income tax deducted at source.', ok: statutory },
  { key: 'otherDeductionsAccountId', label: 'Other deductions payable', hint: 'Advances and other recoveries held for third parties.', ok: liability },
] as const
type Key = (typeof SLOTS)[number]['key']

function Accounts({ companyId }: { companyId: string }) {
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'payroll:manage')
  const settings = usePayrollSettings(companyId)
  const accounts = useAccounts(companyId)
  const save = useSavePayrollSettings(companyId)
  const flash = useFlash()
  const [picked, setPicked] = useState<Partial<Record<Key, LedgerAccount | null>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  if (settings.isPending || accounts.isPending) return <Spinner />
  const current = (k: Key): LedgerAccount | null => (k in picked ? picked[k] ?? null : accounts.data?.find((a) => a.id === settings.data?.[k]) ?? null)
  const complete = SLOTS.every((s) => current(s.key))
  return (
    <Card title="Accounts used by payroll">
      <p className="mb-3 max-w-3xl text-sm text-muted">A payroll run posts to the books, so each account must be chosen once. The standard chart has no payable accounts for salary, PF, ESI or professional tax: add them under Chart of accounts first. Which accounts to use is for your accountant to confirm.</p>
      <div className="grid max-w-3xl gap-4">{SLOTS.map((s) => <div key={s.key}><AccountPicker label={s.label} groups value={current(s.key)} filter={s.ok} onPick={(a) => setPicked({ ...picked, [s.key]: a })} /><p className="mt-0.5 text-xs text-muted">{s.hint}</p></div>)}</div>
      {problem ? <Alert>{problem}</Alert> : null}
      {canManage ? <Button className="mt-4" busy={save.isPending} disabled={!complete} onClick={async () => { setProblem(null); try { await save.mutateAsync(Object.fromEntries(SLOTS.map((s) => [s.key, current(s.key)?.id ?? null]))); flash.show('Payroll accounts saved.') } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') } }}>Save accounts</Button> : <p className="mt-3 text-xs text-muted">You need the manage right to change these.</p>}
    </Card>
  )
}

function Rules({ companyId }: { companyId: string }) {
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'payroll:manage')
  const [state, setState] = useState('27')
  const rules = usePayrollRules(companyId, todayIso(), state)
  const seed = useSeedPayrollRules()
  const flash = useFlash()
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState<null | 'rates' | 'tds_new' | 'tds_old' | 'pt'>(null)
  const fy = (() => { const d = new Date(); return `${d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1}-04-01` })()
  const r = rules.data
  const ready = Boolean(r?.pf && r?.esi && r.regimes.length && r.regimes.every((x) => x.missing.length === 0))
  return (
    <div className="flex flex-col gap-3">
      <Alert tone="info">Provident fund, ESI, income-tax slabs and professional tax are statutory and change. The starting values below are the 2025-26 figures from the system and <b>must be confirmed by your accountant</b> before the first run.</Alert>
      <div className="w-72"><SelectField label="Professional-tax state" value={state} onChange={(e) => setState(e.target.value)} options={STATES.map((s) => ({ value: s.code, label: s.name }))} /></div>
      {rules.isPending ? <Spinner /> : rules.error ? <Alert>{rules.error.message}</Alert> : r ? (
        <Card title={`Rules in force today · ${ready ? 'complete' : 'incomplete'}`}>
          <dl className="grid max-w-2xl grid-cols-2 gap-x-8 gap-y-1 text-sm" aria-label="Statutory rules">
            <div className="flex justify-between"><dt className="text-muted">PF, employee / employer</dt><dd className="num">{r.pf ? `${Number(r.pf.employeePercent)}% / ${Number(r.pf.employerPercent)}%` : 'not set'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">PF wage ceiling</dt><dd className="num">{r.pf ? formatInr(r.pf.ceiling) : ''}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">ESI, employee / employer</dt><dd className="num">{r.esi ? `${Number(r.esi.employeePercent)}% / ${Number(r.esi.employerPercent)}%` : 'not set'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">ESI wage ceiling</dt><dd className="num">{r.esi ? formatInr(r.esi.ceiling) : ''}</dd></div>
            {r.regimes.map((x) => <div key={x.regime} className="col-span-2 mt-1 border-t border-line pt-1"><div className="font-medium">{x.regime === 'new' ? 'New tax regime' : 'Old tax regime'}</div>
              <div className="flex justify-between"><dt className="text-muted">Income-tax slabs / professional-tax slabs</dt><dd className="num">{x.tdsSlabs} / {x.ptSlabs}</dd></div>
              {x.standardDeduction ? <div className="flex justify-between"><dt className="text-muted">Standard deduction</dt><dd className="num">{formatInr(x.standardDeduction)}</dd></div> : null}
              {x.rebateLimit ? <div className="flex justify-between"><dt className="text-muted">Rebate up to income of</dt><dd className="num">{formatInr(x.rebateLimit)}</dd></div> : null}
              {x.missing.length ? <p className="text-xs text-bad">Missing: {x.missing.join(', ')}</p> : null}</div>)}
          </dl>
        </Card>) : null}
      {problem ? <Alert>{problem}</Alert> : null}
      {canManage ? <Button variant="secondary" className="self-start" busy={seed.isPending} onClick={async () => { setProblem(null); try { const x = await seed.mutateAsync({ companyId, effectiveFrom: fy }); flash.show(`Starting values loaded from ${x.effectiveFrom}: ${x.rates} rates, ${x.slabSets.join(', ')} slabs.`) } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not load the starting values.') } }}>Load starting values (confirm with your accountant)</Button> : null}
      {canManage ? <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setEditing('rates')}>Change rates</Button><Button variant="secondary" onClick={() => setEditing('tds_new')}>Income-tax slabs, new regime</Button><Button variant="secondary" onClick={() => setEditing('tds_old')}>Income-tax slabs, old regime</Button><Button variant="secondary" onClick={() => setEditing('pt')}>Professional-tax slabs for this state</Button></div> : null}
      {editing === 'rates' ? <RateEditor companyId={companyId} onClose={() => setEditing(null)} /> : null}
      {editing && editing !== 'rates' ? <SlabEditor key={`${editing}${state}`} companyId={companyId} kind={editing} state={state} current={(editing === 'pt' ? r?.regimes[0]?.ptSlabDetail : r?.regimes.find((x) => x.regime === (editing === 'tds_new' ? 'new' : 'old'))?.tdsSlabDetail) ?? []} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

const RATE_FIELDS = [
  ['pf_employee_percent', 'PF, employee (%)'], ['pf_employer_percent', 'PF, employer (%)'], ['pf_wage_ceiling', 'PF wage ceiling'], ['esi_employee_percent', 'ESI, employee (%)'], ['esi_employer_percent', 'ESI, employer (%)'], ['esi_wage_ceiling', 'ESI wage ceiling'],
  ['tds_cess_percent', 'Income-tax cess (%)'], ['tds_std_deduction_new', 'Standard deduction, new regime'], ['tds_rebate_limit_new', 'Rebate limit, new regime'], ['tds_rebate_amount_new', 'Rebate amount, new regime'],
  ['tds_std_deduction_old', 'Standard deduction, old regime'], ['tds_rebate_limit_old', 'Rebate limit, old regime'], ['tds_rebate_amount_old', 'Rebate amount, old regime'],
] as const
const num = /^\d{1,14}(\.\d{1,4})?$/

function RateEditor({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const put = usePutRates(); const flash = useFlash()
  const [from, setFrom] = useState(todayIso())
  const [vals, setVals] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const changed = Object.entries(vals).filter(([, v]) => v.trim() !== '')
  return (
    <Drawer title="Change statutory rates" onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        <Alert tone="info">A rate is never edited: the change takes effect from the date you give, and earlier months keep the rate they had. Enter only what changes, and have your accountant confirm the figures.</Alert>
        <TextField label="Effective from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">{RATE_FIELDS.map(([code, label]) => <TextField key={code} label={label} inputMode="decimal" value={vals[code] ?? ''} onChange={(e) => setVals({ ...vals, [code]: e.target.value })} />)}</div>
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={put.isPending} disabled={changed.length === 0 || changed.some(([, v]) => !num.test(v.trim()))} onClick={async () => { setProblem(null); try { await put.mutateAsync({ companyId, effectiveFrom: from, rates: changed.map(([code, value]) => ({ code, value: value.trim() })) }); flash.show(`${changed.length} rate(s) set from ${from}.`); onClose() } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') } }}>Save rates</Button>
      </div>
    </Drawer>
  )
}

interface SlabDraft { key: string; from: string; to: string; value: string }
let slabN = 0
function SlabEditor({ companyId, kind, state, current, onClose }: { companyId: string; kind: 'tds_new' | 'tds_old' | 'pt'; state: string; current: SlabRow[]; onClose: () => void }) {
  const put = usePutSlabs(); const flash = useFlash()
  const pt = kind === 'pt'
  const [from, setFrom] = useState(todayIso())
  const [rows, setRows] = useState<SlabDraft[]>(() => (current.length ? current : [{ from: '0', to: null, ratePercent: '0', fixedAmount: '0' }]).map((s) => ({ key: `s${++slabN}`, from: String(Number(s.from)), to: s.to === null ? '' : String(Number(s.to)), value: String(Number(pt ? s.fixedAmount ?? 0 : s.ratePercent ?? 0)) })))
  const [problem, setProblem] = useState<string | null>(null)
  const valid = rows.length > 0 && rows.every((r) => num.test(r.from) && (r.to === '' || num.test(r.to)) && num.test(r.value))
  const title = kind === 'pt' ? `Professional-tax slabs (${STATES.find((s) => s.code === state)?.name ?? state})` : kind === 'tds_new' ? 'Income-tax slabs, new regime' : 'Income-tax slabs, old regime'
  return (
    <Drawer title={title} onClose={onClose} width={620}>
      <div className="flex flex-col gap-4">
        <Alert tone="info">The slabs shown are the ones in force today. A new set takes effect from the date you give; earlier months keep the old set. Leave &ldquo;up to&rdquo; empty on the last slab. Have your accountant confirm the figures.</Alert>
        <TextField label="Effective from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <table className="w-full text-sm" aria-label="Slabs"><thead><tr className="text-left text-xs text-muted"><th className="py-1">From</th><th className="py-1">Up to</th><th className="py-1">{pt ? 'Tax per month' : 'Rate %'}</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key}>{(['from', 'to', 'value'] as const).map((f) => <td key={f} className="py-1 pr-2"><input aria-label={`${f === 'value' ? (pt ? 'Amount' : 'Rate') : f === 'from' ? 'From' : 'Up to'} ${rows.indexOf(r) + 1}`} inputMode="decimal" className="h-8 w-full rounded border border-line bg-surface px-2 text-sm" value={r[f]} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, [f]: e.target.value } : x)))} /></td>)}
            <td><Button variant="ghost" aria-label={`Remove slab ${rows.indexOf(r) + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>×</Button></td></tr>)}</tbody></table>
        <Button variant="ghost" className="self-start" onClick={() => setRows([...rows, { key: `s${++slabN}`, from: rows.at(-1)?.to ?? '', to: '', value: '0' }])}>+ Add slab</Button>
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={put.isPending} disabled={!valid} onClick={async () => { setProblem(null); try { await put.mutateAsync({ companyId, kind, ...(pt ? { stateCode: state } : {}), effectiveFrom: from, slabs: rows.map((r) => ({ from: r.from, to: r.to === '' ? null : r.to, ...(pt ? { fixedAmount: r.value } : { ratePercent: r.value }) })) }); flash.show('Slabs saved.'); onClose() } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') } }}>Save slabs</Button>
      </div>
    </Drawer>
  )
}

function Components({ companyId }: { companyId: string }) {
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'payroll:manage')
  const list = useComponents(companyId)
  const create = useCreateComponent(); const update = useUpdateComponent()
  const flash = useFlash()
  const [adding, setAdding] = useState(false)
  const schema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,19}$/, 'Capital letters, digits and _'), name: z.string().trim().min(1, 'Required').max(120), kind: z.string(), calculation: z.string(), percent: z.string(), isTaxable: z.boolean(), pfWage: z.boolean(), esiWage: z.boolean() })
    .refine((v) => (v.calculation === 'percent_of_basic') === (v.percent.trim() !== '' && Number(v.percent) > 0), { path: ['percent'], message: 'Give a percent for percent-of-basic components only' })
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between"><p className="max-w-3xl text-sm text-muted">Pay components besides basic pay. Percent-of-basic ones (such as HRA) follow the basic; fixed ones take an amount per employee in their salary structure.</p>{canManage ? <Button onClick={() => setAdding(true)}>New component</Button> : null}</div>
      {list.isPending ? <Spinner /> : list.data?.length === 0 ? <Alert tone="info">No components yet. Basic pay needs none.</Alert> : (
        <div className="overflow-auto rounded-lg border border-line bg-surface"><table className="w-full text-sm" aria-label="Pay components"><thead><tr className="bg-canvas text-left text-xs text-muted"><th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Kind</th><th className="p-2">Calculation</th><th className="p-2">Counts for</th><th className="p-2">Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{list.data?.map((c) => <tr key={c.id} className="border-t border-line/60"><td className="p-2">{c.code}</td><td className="p-2">{c.name}</td><td className="p-2">{c.kind === 'earning' ? 'Earning' : 'Deduction'}</td><td className="p-2">{c.calculation === 'fixed' ? 'Fixed amount' : `${Number(c.percent)}% of basic`}</td><td className="p-2 text-muted">{[c.isTaxable && 'tax', c.pfWage && 'PF', c.esiWage && 'ESI'].filter(Boolean).join(', ')}</td><td className="p-2">{c.status}</td>
            <td className="p-2 text-right">{canManage ? <Button variant="ghost" onClick={() => void update.mutateAsync({ id: c.id, body: { status: c.status === 'active' ? 'inactive' : 'active' } })}>{c.status === 'active' ? 'Deactivate' : 'Activate'}</Button> : null}</td></tr>)}</tbody></table></div>)}
      {adding ? (
        <Drawer title="New pay component" onClose={() => setAdding(false)}>
          <SimpleForm schema={schema} defaults={{ code: '', name: '', kind: 'earning', calculation: 'fixed', percent: '', isTaxable: true, pfWage: false, esiWage: false }} fields={['code', 'name', 'kind', 'calculation', 'percent', 'isTaxable', 'pfWage', 'esiWage']} label="Create"
            submit={async (v) => { await create.mutateAsync({ companyId, code: v.code, name: v.name, kind: v.kind, calculation: v.calculation, ...(v.calculation === 'percent_of_basic' ? { percent: v.percent } : {}), isTaxable: v.isTaxable, pfWage: v.kind === 'earning' && v.pfWage, esiWage: v.kind === 'earning' && v.esiWage }); setAdding(false); flash.show('Component created.') }}>
            {({ register, errors }) => (<><TextField label="Code" error={errors.code?.message as string | undefined} {...register('code')} /><TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} />
              <SelectField label="Kind" options={[{ value: 'earning', label: 'Earning' }, { value: 'deduction', label: 'Deduction' }]} {...register('kind')} /><SelectField label="Calculation" options={[{ value: 'fixed', label: 'Fixed amount' }, { value: 'percent_of_basic', label: 'Percent of basic' }]} {...register('calculation')} />
              <TextField label="Percent of basic" error={errors.percent?.message as string | undefined} {...register('percent')} /><CheckField label="Taxable" {...register('isTaxable')} /><CheckField label="Counts as PF wages (earnings only)" {...register('pfWage')} /><CheckField label="Counts as ESI wages (earnings only)" {...register('esiWage')} /></>)}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}

export function PayrollSetupPage() {
  const ws = useWorkspace()
  const [tab, setTab] = useState<Tab>('accounts')
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Payroll setup</h1>
      <div role="tablist" className="flex gap-1 border-b border-line">{([['accounts', 'Accounts'], ['rules', 'Statutory rules'], ['components', 'Pay components']] as [Tab, string][]).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'accounts' ? <Accounts companyId={ws.company.id} /> : tab === 'rules' ? <Rules companyId={ws.company.id} /> : <Components companyId={ws.company.id} />}
    </div>
  )
}
