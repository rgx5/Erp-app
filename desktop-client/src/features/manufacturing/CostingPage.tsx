import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { LedgerAccount } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatInr, todayIso } from '@/domain/format'
import { AccountPicker } from '@/features/accounting/AccountPicker'
import { useAccounts } from '@/features/accounting/queries'
import { download, toCsv } from '@/features/masterdata/csv'
import { useItemsById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useMfgSettings, useSaveMfgSettings, useVariances, useWip } from './queries'

type Tab = 'variances' | 'wip' | 'settings'
const fyStart = (): string => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01` }
const SLOTS = [
  { key: 'wipAccountId', label: 'Work in progress', hint: 'A work-in-progress control account (asset). Materials and costs sit here while an order is open.', ok: (a: LedgerAccount) => a.controlKind === 'work_in_progress' },
  { key: 'labourAbsorbedAccountId', label: 'Labour and machine cost absorbed', hint: 'An ordinary expense account credited with the labour and machine cost charged to orders.', ok: (a: LedgerAccount) => a.type === 'expense' && a.controlKind === null },
  { key: 'overheadAbsorbedAccountId', label: 'Overhead absorbed', hint: 'An ordinary expense account credited with the overhead charged to orders.', ok: (a: LedgerAccount) => a.type === 'expense' && a.controlKind === null },
  { key: 'productionVarianceAccountId', label: 'Production variance', hint: 'Where any cost left after the finished goods are valued goes when an order is completed.', ok: (a: LedgerAccount) => a.type === 'expense' && a.controlKind === null },
  { key: 'subcontractClearingAccountId', label: 'Job-work charges', hint: 'An ordinary expense account for job-work charges.', ok: (a: LedgerAccount) => a.type === 'expense' && a.controlKind === null },
] as const
type SlotKey = (typeof SLOTS)[number]['key']

function Settings({ companyId }: { companyId: string }) {
  const perms = useSession((s) => s.me?.permissions ?? [])
  const canManage = can(perms, 'manufacturing:manage')
  const settings = useMfgSettings(companyId)
  const accounts = useAccounts(companyId)
  const save = useSaveMfgSettings(companyId)
  const flash = useFlash()
  const [picked, setPicked] = useState<Partial<Record<SlotKey, LedgerAccount | null>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  if (settings.isPending || accounts.isPending) return <Spinner />
  const current = (k: SlotKey): LedgerAccount | null => (k in picked ? picked[k] ?? null : accounts.data?.find((a) => a.id === settings.data?.[k]) ?? null)
  const complete = SLOTS.every((s) => current(s.key))
  return (
    <Card title="Accounts used by production">
      <p className="mb-3 max-w-3xl text-sm text-muted">Production posts to the books, so each of these must be chosen once before work orders can be released. Which account suits each purpose is for your accountant to confirm.</p>
      <div className="grid max-w-3xl gap-4">
        {SLOTS.map((s) => <div key={s.key}><AccountPicker label={s.label} groups value={current(s.key)} filter={s.ok} onPick={(a) => setPicked({ ...picked, [s.key]: a })} /><p className="mt-0.5 text-xs text-muted">{s.hint}</p></div>)}
      </div>
      {problem ? <Alert>{problem}</Alert> : null}
      {canManage ? <Button className="mt-4" busy={save.isPending} disabled={!complete} onClick={async () => { setProblem(null); try { await save.mutateAsync(Object.fromEntries(SLOTS.map((s) => [s.key, current(s.key)?.id ?? null])) as never); flash.show('Production accounts saved.') } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') } }}>Save accounts</Button> : <p className="mt-3 text-xs text-muted">You need the manage right to change these.</p>}
    </Card>
  )
}

export function CostingPage() {
  const ws = useWorkspace()
  const [tab, setTab] = useState<Tab>('variances')
  const [from, setFrom] = useState(fyStart())
  const [to, setTo] = useState(todayIso())
  const v = useVariances(tab === 'variances' ? ws.company?.id : undefined, from, to)
  const wip = useWip(tab === 'wip' ? ws.company?.id : undefined, to)
  const items = useItemsById(v.data?.workOrders.map((w) => w.itemId) ?? [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Production costing</h1>
      <div role="tablist" className="flex gap-1 border-b border-line">
        {([['variances', 'Variances'], ['wip', 'Work in progress'], ['settings', 'Accounts']] as [Tab, string][]).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab !== 'settings' ? <Toolbar>{tab === 'variances' ? <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div> : null}<div className="w-40"><TextField label={tab === 'wip' ? 'As of' : 'To'} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></Toolbar> : null}
      {tab === 'variances' ? (v.isPending ? <Spinner /> : v.error ? <Alert>{v.error.message}</Alert> : v.data ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Completed work orders: what each cost against what its own plan would have cost. Negative is cheaper than planned.</p>
          <div className="overflow-auto rounded-lg border border-line bg-surface"><table className="w-full text-sm" aria-label="Variances">
            <thead><tr className="bg-canvas text-left text-xs text-muted"><th className="p-2">Work order</th><th className="p-2">Item</th><th className="p-2 text-right">Planned</th><th className="p-2 text-right">Actual</th><th className="p-2 text-right">Variance</th><th className="p-2 text-right">Material usage</th><th className="p-2 text-right">Efficiency</th></tr></thead>
            <tbody>{v.data.workOrders.map((w) => <tr key={w.workOrderId} className="border-t border-line/60"><td className="p-2"><Link to="/manufacturing/orders/$orderId" params={{ orderId: w.workOrderId }} className="underline">{w.woNo}</Link></td><td className="p-2">{items.data?.get(w.itemId)?.code ?? ''}</td><td className="num p-2 text-right">{formatInr(w.planned)}</td><td className="num p-2 text-right">{formatInr(w.actual)}</td><td className="num p-2 text-right">{formatInr(w.variance)}</td><td className="num p-2 text-right">{formatInr(w.usage)}</td><td className="num p-2 text-right">{formatInr(w.efficiency)}</td></tr>)}
              <tr className="border-t border-line bg-canvas font-semibold"><td className="p-2" colSpan={2}>Total</td><td className="num p-2 text-right">{formatInr(v.data.totals.planned)}</td><td className="num p-2 text-right">{formatInr(v.data.totals.actual)}</td><td className="num p-2 text-right">{formatInr(v.data.totals.variance)}</td><td className="num p-2 text-right">{formatInr(v.data.totals.usage)}</td><td className="num p-2 text-right">{formatInr(v.data.totals.efficiency)}</td></tr></tbody></table></div>
          <Button variant="secondary" className="self-start" onClick={() => download('production-variances.csv', toCsv(['Work order', 'Planned', 'Actual', 'Variance', 'Usage', 'Efficiency'], v.data.workOrders.map((w) => [w.woNo, w.planned, w.actual, w.variance, w.usage, w.efficiency])))}>Export CSV</Button>
        </div>
      ) : null) : null}
      {tab === 'wip' ? (wip.isPending ? <Spinner /> : wip.error ? <Alert>{wip.error.message}</Alert> : wip.data ? (
        <Card title="Work in progress against the books">
          <dl className="max-w-md text-sm" aria-label="WIP reconciliation"><div className="flex justify-between py-1"><dt>Open work orders</dt><dd className="num">{formatInr(wip.data.documents)}</dd></div><div className="flex justify-between py-1"><dt>Work-in-progress account</dt><dd className="num">{formatInr(wip.data.ledger)}</dd></div><div className="flex justify-between border-t border-line py-1 font-semibold"><dt>Difference</dt><dd className="num">{formatInr(wip.data.difference)}</dd></div></dl>
          <p className={`mt-2 text-sm ${wip.data.reconciled ? 'text-good' : 'text-bad'}`}>{wip.data.reconciled ? 'The books agree with the open work orders.' : 'The books do not agree with the open work orders.'}</p>
          {wip.data.workOrders.length ? <ul className="mt-2 text-sm">{wip.data.workOrders.map((w) => <li key={w.id} className="flex justify-between"><Link to="/manufacturing/orders/$orderId" params={{ orderId: w.id }} className="underline">{w.woNo}</Link><span className="num">{formatInr(w.wip)}</span></li>)}</ul> : null}
        </Card>
      ) : null) : null}
      {tab === 'settings' ? <Settings companyId={ws.company.id} /> : null}
    </div>
  )
}
