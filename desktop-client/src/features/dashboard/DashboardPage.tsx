import { Link } from '@tanstack/react-router'
import { ApiError } from '@/api/errors'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useChosenCompany, useCompanies } from '@/features/organization/queries'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { Alert, Card, Spinner } from '@/ui/primitives'
import { useSetupStatus } from '@/features/setup/queries'
import { useDashboard } from './queries'

function Kpi({ label, value, tone, note, to }: { label: string; value: string; tone?: 'good' | 'bad' | undefined; note?: string | undefined; to?: string | undefined }) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`num mt-1 text-xl font-semibold ${tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : ''}`}>{value}</p>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </>
  )
  const box = 'block rounded-lg border border-line bg-surface p-4'
  return to ? <Link to={to as never} className={`${box} hover:border-brand`}>{body}</Link> : <div className={box}>{body}</div>
}

/** Profit by month as bars: above the line green, below it red. Plain SVG, no library. */
function TrendChart({ rows }: { rows: { month: string; profit: string }[] }) {
  const vals = rows.map((r) => Number(r.profit))
  const max = Math.max(1, ...vals.map(Math.abs))
  const w = 34; const gap = 14; const h = 130; const mid = h / 2
  return (
    <svg role="img" aria-label="Profit by month" viewBox={`0 0 ${rows.length * (w + gap)} ${h + 18}`} className="h-44 w-full">
      <line x1="0" x2={rows.length * (w + gap)} y1={mid} y2={mid} stroke="currentColor" className="text-line" />
      {rows.map((r, i) => { const v = vals[i] as number; const bar = (Math.abs(v) / max) * (mid - 4); return (
        <g key={r.month}><rect x={i * (w + gap) + gap / 2} y={v >= 0 ? mid - bar : mid} width={w} height={Math.max(bar, v === 0 ? 0 : 1)} rx="2" className={v >= 0 ? 'fill-good' : 'fill-bad'}><title>{`${r.month}: ${formatInr(r.profit)}`}</title></rect>
          <text x={i * (w + gap) + gap / 2 + w / 2} y={h + 12} textAnchor="middle" className="fill-muted text-[9px]">{r.month.slice(5)}</text></g>) })}
    </svg>
  )
}

export function DashboardPage() {
  const companies = useCompanies()
  const { companyId, choose } = useChosenCompany()
  const list = companies.data ?? []
  const active = list.find((c) => c.id === companyId) ?? list[0]
  const asOf = todayIso()
  const dash = useDashboard(active?.id ?? null, asOf)
  const setup = useSetupStatus(active?.id)
  const perms = useSession((x) => x.me?.permissions ?? [])
  const go = (perm: string, to: string): string | undefined => (can(perms, perm) ? to : undefined)

  if (companies.isPending || companies.error || !active) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        {companies.isPending ? <Spinner /> : companies.error ? <Alert>{companies.error.message}</Alert> : <Alert tone="info">No company is set up yet. <Link to="/setup" className="underline">Set up your business</Link> to see the dashboard.</Alert>}
      </div>
    )
  }

  const d = dash.data
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-xs text-muted">{d ? `${d.fiscalYear.label} · as of ${formatDate(d.asOf)}` : `as of ${formatDate(asOf)}`}</p>
        </div>
        {list.length > 1 ? (
          <select aria-label="Company" className="h-9 rounded-md border border-line bg-surface px-2 text-sm" value={active.id} onChange={(e) => choose(e.target.value)}>
            {list.map((c) => <option key={c.id} value={c.id}>{c.tradeName ?? c.legalName}</option>)}
          </select>
        ) : <span className="text-sm font-medium">{active.tradeName ?? active.legalName}</span>}
      </div>

      {setup.data && !setup.data.ready ? <Alert tone="info">Setup is not finished yet ({setup.data.checks.filter((c) => !c.done).length} steps left). <Link to="/setup" className="underline">Continue setup</Link></Alert> : null}
      {dash.isPending ? <Spinner /> : null}
      {dash.error ? <Alert>{dash.error instanceof ApiError && dash.error.code === 'no_fiscal_year' ? 'There is no fiscal year for today. Create one under Accounting.' : dash.error.message}</Alert> : null}

      {d ? (
        <>
          <div className="grid grid-cols-5 gap-3">
            <Kpi label="Cash and bank" value={formatInr(d.cash.total)} to={go('bank:read', '/accounting/bank')} />
            <Kpi label="Profit this month" value={formatInr(d.month.profit)} tone={d.month.profit.startsWith('-') ? 'bad' : 'good'} note={`Revenue ${formatInr(d.month.revenue)}`} />
            <Kpi label="Profit this year" value={formatInr(d.yearToDate.profit)} tone={d.yearToDate.profit.startsWith('-') ? 'bad' : 'good'} note={d.yearToDate.netMarginPercent ? `${d.yearToDate.netMarginPercent}% net margin` : undefined} />
            <Kpi label="Stock value" value={formatInr(d.inventoryValue)} to={go('stock:read', '/inventory/valuation')} />
            <Kpi label="Receivables" value={formatInr(d.receivables.total)} note={`Overdue ${formatInr(d.receivables.overdue)}`} tone={Number(d.receivables.overdue) > 0 ? 'bad' : undefined} to={go('receivables:read', '/sales/receivables')} />
            <Kpi label="Payables" value={formatInr(d.payables.total)} note={`Overdue ${formatInr(d.payables.overdue)}`} tone={Number(d.payables.overdue) > 0 ? 'bad' : undefined} to={go('payables:read', '/purchasing/payables')} />
            <Kpi label="Waiting for approval" value={String(d.attention.pendingApprovals)} to={go('approvals:read', '/approvals')} />
            <Kpi label="Bank lines to match" value={String(d.attention.unmatchedBankLines)} to={go('bank:read', '/accounting/bank')} />
            <Kpi label="Open purchase orders" value={String(d.attention.openPurchaseOrders)} to={go('purchasing:read', '/purchasing/orders')} />
            <Kpi label="Open work orders" value={String(d.attention.openWorkOrders)} to={go('manufacturing:read', '/manufacturing/orders')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Card title="Profit by month"><TrendChart rows={d.trend} /></Card>
            <Card title="Cash and bank accounts">
              <table className="w-full text-sm" aria-label="Cash and bank accounts"><tbody>{d.cash.accounts.map((a) => <tr key={a.accountId} className="border-t border-line/60 first:border-0"><td className="py-1.5">{a.code} · {a.name}</td><td className="num py-1.5 text-right">{formatInr(a.balance)}</td></tr>)}{d.cash.accounts.length === 0 ? <tr><td className="py-2 text-muted">No cash or bank account has a balance yet.</td></tr> : null}</tbody></table>
            </Card>
          </div>
          <Card title="Month by month">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1">Month</th><th className="num py-1 text-right">Revenue</th><th className="num py-1 text-right">Expenses</th><th className="num py-1 text-right">Profit</th></tr></thead>
              <tbody>
                {d.trend.map((t) => (
                  <tr key={t.month} className="border-t border-line/60">
                    <td className="py-1.5">{t.month}</td>
                    <td className="num py-1.5 text-right">{formatInr(t.revenue)}</td>
                    <td className="num py-1.5 text-right">{formatInr(t.expenses)}</td>
                    <td className={`num py-1.5 text-right ${t.profit.startsWith('-') ? 'text-bad' : ''}`}>{formatInr(t.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}
    </div>
  )
}
