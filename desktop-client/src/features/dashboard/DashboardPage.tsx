import { ApiError } from '@/api/errors'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useChosenCompany, useCompanies } from '@/features/organization/queries'
import { Alert, Card, Spinner } from '@/ui/primitives'
import { useDashboard } from './queries'

function Kpi({ label, value, tone, note }: { label: string; value: string; tone?: 'good' | 'bad'; note?: string | undefined }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`num mt-1 text-xl font-semibold ${tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : ''}`}>{value}</p>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </div>
  )
}

export function DashboardPage() {
  const companies = useCompanies()
  const { companyId, choose } = useChosenCompany()
  const list = companies.data ?? []
  const active = list.find((c) => c.id === companyId) ?? list[0]
  const asOf = todayIso()
  const dash = useDashboard(active?.id ?? null, asOf)

  if (companies.isPending || companies.error || !active) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        {companies.isPending ? <Spinner /> : companies.error ? <Alert>{companies.error.message}</Alert> : <Alert tone="info">No company is set up yet. Create one under Organization to see the dashboard.</Alert>}
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

      {dash.isPending ? <Spinner /> : null}
      {dash.error ? <Alert>{dash.error instanceof ApiError && dash.error.code === 'no_fiscal_year' ? 'There is no fiscal year for today. Create one under Accounting.' : dash.error.message}</Alert> : null}

      {d ? (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Kpi label="Cash and bank" value={formatInr(d.cash.total)} />
            <Kpi label="Profit this month" value={formatInr(d.month.profit)} tone={d.month.profit.startsWith('-') ? 'bad' : 'good'} note={`Revenue ${formatInr(d.month.revenue)}`} />
            <Kpi label="Profit this year" value={formatInr(d.yearToDate.profit)} tone={d.yearToDate.profit.startsWith('-') ? 'bad' : 'good'} note={d.yearToDate.netMarginPercent ? `${d.yearToDate.netMarginPercent}% net margin` : undefined} />
            <Kpi label="Stock value" value={formatInr(d.inventoryValue)} />
            <Kpi label="Receivables" value={formatInr(d.receivables.total)} note={`Overdue ${formatInr(d.receivables.overdue)}`} />
            <Kpi label="Payables" value={formatInr(d.payables.total)} note={`Overdue ${formatInr(d.payables.overdue)}`} />
            <Kpi label="Waiting for approval" value={String(d.attention.pendingApprovals)} />
            <Kpi label="Bank lines to match" value={String(d.attention.unmatchedBankLines)} />
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
