import { useState } from 'react'
import { z } from 'zod'
import type { LedgerAccount } from '@/api/schemas'
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
import { useComponents, useCreateComponent, usePayrollRules, usePayrollSettings, useSavePayrollSettings, useSeedPayrollRules, useUpdateComponent } from './queries'

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
      <p className="text-xs text-muted">Not yet: editing individual rates and slabs, old-regime slabs and other states&apos; professional-tax slabs from the app.</p>
    </div>
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
        <div className="overflow-auto rounded-lg border border-line bg-surface"><table className="w-full text-sm" aria-label="Pay components"><thead><tr className="bg-canvas text-left text-xs text-muted"><th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Kind</th><th className="p-2">Calculation</th><th className="p-2">Counts for</th><th className="p-2">Status</th><th /></tr></thead>
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
      <h1 className="text-lg font-semibold">Payroll setup</h1>
      <div role="tablist" className="flex gap-1 border-b border-line">{([['accounts', 'Accounts'], ['rules', 'Statutory rules'], ['components', 'Pay components']] as [Tab, string][]).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'accounts' ? <Accounts companyId={ws.company.id} /> : tab === 'rules' ? <Rules companyId={ws.company.id} /> : <Components companyId={ws.company.id} />}
    </div>
  )
}
