import { Link } from '@tanstack/react-router'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { ApiError } from '@/api/errors'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useChosenCompany, useCompanies } from '@/features/organization/queries'
import { can } from '@/auth/permissions'
import { isStarter } from '@/auth/edition'
import { retryNow } from '@/auth/reconnect'
import { useSession } from '@/auth/session'
import { Alert, Button, Card, PageHeader, Spinner } from '@/ui/primitives'
import { useSetupStatus } from '@/features/setup/queries'
import { useDashboard } from './queries'

/** One figure in the strip across the top: a small label, the number, and a line of context (often a change against last month). */
function Metric({ label, value, tone, note, noteTone, to }: { label: string; value: string; tone?: 'good' | 'bad' | undefined; note?: string | undefined; noteTone?: 'good' | 'bad' | undefined; to?: string | undefined }) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className={`num mt-1.5 text-[22px] font-semibold leading-none tracking-tight ${tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : ''}`}>{value}</p>
      {note ? <p className={`mt-2 text-xs ${noteTone === 'bad' ? 'text-bad' : noteTone === 'good' ? 'text-good' : 'text-muted'}`}>{note}</p> : <p className="mt-2 text-xs">&nbsp;</p>}
    </>
  )
  return to ? <Link to={to as never} className="block px-5 py-4 transition-colors hover:bg-sunken">{body}</Link> : <div className="px-5 py-4">{body}</div>
}

/** What needs doing, as a short list: each line is a count and a way in. Zero counts stay quiet. */
function Attention({ rows }: { rows: { label: string; count: number; to: string | undefined; amount?: string | undefined }[] }) {
  const open = rows.filter((r) => r.count > 0)
  return (
    <ul className="divide-y divide-line/70" aria-label="Needs attention">
      {rows.map((r) => {
        const inner = (
          <>
            <span className={`grid size-5 place-items-center rounded text-[11px] font-semibold ${r.count > 0 ? 'bg-warn-soft text-warn' : 'bg-sunken text-faint'}`}>{r.count}</span>
            <span className={`flex-1 ${r.count > 0 ? '' : 'text-muted'}`}>{r.label}</span>
            {r.amount && r.count > 0 ? <span className="num text-xs text-bad">{r.amount}</span> : null}
            {r.to && r.count > 0 ? <ChevronRight className="size-3.5 text-faint" aria-hidden /> : null}
          </>
        )
        return <li key={r.label}>{r.to && r.count > 0 ? <Link to={r.to as never} className="flex items-center gap-2.5 px-4 py-2 text-[13px] hover:bg-sunken">{inner}</Link> : <div className="flex items-center gap-2.5 px-4 py-2 text-[13px]">{inner}</div>}</li>
      })}
      {open.length === 0 ? <li className="px-4 py-2 text-xs text-good">Nothing is waiting for you.</li> : null}
    </ul>
  )
}

/** Revenue (pale) and profit (solid) by month: plain SVG, no library. A loss shows below the line in red. */
function TrendChart({ rows, profit: showProfit = true }: { rows: { month: string; revenue: string; profit: string }[]; profit?: boolean }) {
  const rev = rows.map((r) => Number(r.revenue)); const prof = rows.map((r) => Number(r.profit))
  const max = Math.max(1, ...rev, ...prof.map(Math.abs))
  const w = 22; const gap = 18; const h = 150; const mid = h * 0.82
  const x = (i: number): number => i * (2 * w + gap) + gap / 2
  const scale = (v: number): number => (Math.abs(v) / max) * (mid - 6)
  const grid = [0.25, 0.5, 0.75, 1].map((f) => ({ y: mid - f * (mid - 6), label: f * max }))
  return (
    <svg role="img" aria-label="Revenue and profit by month" viewBox={`0 0 ${rows.length * (2 * w + gap)} ${h + 16}`} className="h-52 w-full" preserveAspectRatio="none">
      {grid.map((g) => <line key={g.y} x1="0" x2={rows.length * (2 * w + gap)} y1={g.y} y2={g.y} stroke="currentColor" className="text-line" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />)}
      <line x1="0" x2={rows.length * (2 * w + gap)} y1={mid} y2={mid} stroke="currentColor" className="text-line-strong" vectorEffect="non-scaling-stroke" />
      {rows.map((r, i) => (
        <g key={r.month}>
          <rect x={x(i)} y={mid - scale(rev[i] as number)} width={w} height={scale(rev[i] as number)} rx="1.5" className="fill-brand/25"><title>{`${r.month} revenue: ${formatInr(r.revenue)}`}</title></rect>
          {showProfit ? <rect x={x(i) + w + 2} y={(prof[i] as number) >= 0 ? mid - scale(prof[i] as number) : mid} width={w} height={Math.max(scale(prof[i] as number), (prof[i] as number) === 0 ? 0 : 1)} rx="1.5" className={(prof[i] as number) >= 0 ? 'fill-good' : 'fill-bad'}><title>{`${r.month} profit: ${formatInr(r.profit)}`}</title></rect> : null}
          <text x={x(i) + w} y={h + 10} textAnchor="middle" className="fill-muted text-[9px]">{MONTHS[Number(r.month.slice(5)) - 1]}</text>
        </g>
      ))}
    </svg>
  )
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function DashboardPage() {
  const companies = useCompanies()
  const { companyId, choose } = useChosenCompany()
  const list = companies.data ?? []
  const active = list.find((c) => c.id === companyId) ?? list[0]
  const asOf = todayIso()
  const dash = useDashboard(active?.id ?? null, asOf)
  const setup = useSetupStatus(active?.id)
  const perms = useSession((x) => x.me?.permissions ?? [])
  const simple = isStarter(useSession((x) => x.me))
  const go = (perm: string, to: string): string | undefined => (can(perms, perm) ? to : undefined)

  if (companies.isPending || companies.error || !active) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="page-title">Dashboard</h1>
        {companies.isPending ? <Spinner /> : companies.error ? <><Alert>{companies.error.message}</Alert><Button className="self-start" variant="secondary" busy={companies.isFetching} onClick={() => void retryNow().then(() => companies.refetch())}>Try again</Button></> : <Alert tone="info">No company is set up yet. <Link to="/setup" className="underline">Set up your business</Link> to see the dashboard.</Alert>}
      </div>
    )
  }

  const d = dash.data
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Dashboard" sub={d ? `${d.fiscalYear.label} · as of ${formatDate(d.asOf)}` : `as of ${formatDate(asOf)}`}>
        <Button variant="secondary" busy={dash.isFetching} onClick={() => void Promise.all([dash.refetch(), setup.refetch()])}><RefreshCw className="size-4" aria-hidden /> Refresh</Button>
        {list.length > 1 ? (
          <select aria-label="Company" className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]" value={active.id} onChange={(e) => choose(e.target.value)}>
            {list.map((c) => <option key={c.id} value={c.id}>{c.tradeName ?? c.legalName}</option>)}
          </select>
        ) : null}
      </PageHeader>

      {setup.data && !setup.data.ready ? <Alert tone="info">Setup is not finished yet ({setup.data.checks.filter((c) => !c.done).length} steps left). <Link to="/setup" className="underline">Continue setup</Link></Alert> : null}
      {dash.isPending ? <Spinner /> : null}
      {dash.error ? <Alert>{dash.error instanceof ApiError && dash.error.code === 'no_fiscal_year' ? 'There is no fiscal year for today. Create one under Accounting.' : dash.error.message}</Alert> : null}

      {d ? (
        <>
          {simple ? (
            <div className="grid grid-cols-4 divide-x divide-line overflow-hidden rounded-lg border border-line bg-surface">
              <Metric label="Cash and bank" value={formatInr(d.cash.total)} to={go('bank:read', '/accounting/bank')} note={`${d.cash.accounts.length} account${d.cash.accounts.length === 1 ? '' : 's'}`} />
              <Metric label="Sales this month" value={formatInr(d.month.revenue)} note={d.month.previousMonth ? `Last month ${formatInr(d.month.previousMonth.revenue)}` : undefined} />
              <Metric label="Customers owe you" value={formatInr(d.receivables.total)} note={Number(d.receivables.overdue) > 0 ? `${formatInr(d.receivables.overdue)} overdue` : 'None overdue'} noteTone={Number(d.receivables.overdue) > 0 ? 'bad' : 'good'} to={go('receivables:read', '/sales/receivables')} />
              <Metric label="Stock value" value={formatInr(d.inventoryValue)} to={go('stock:read', '/inventory/stock')} />
            </div>
          ) : (
          <div className="grid grid-cols-4 divide-x divide-line overflow-hidden rounded-lg border border-line bg-surface">
            <Metric label="Cash and bank" value={formatInr(d.cash.total)} note={`${d.cash.accounts.length} account${d.cash.accounts.length === 1 ? '' : 's'}`} to={go('bank:read', '/accounting/bank')} />
            <Metric label="Revenue this month" value={formatInr(d.month.revenue)} note={d.month.previousMonth ? `Last month ${formatInr(d.month.previousMonth.revenue)}` : `Profit ${formatInr(d.month.profit)}`} />
            <Metric label="Profit this year" value={formatInr(d.yearToDate.profit)} tone={d.yearToDate.profit.startsWith('-') ? 'bad' : undefined} note={d.yearToDate.netMarginPercent ? `${d.yearToDate.netMarginPercent}% net margin` : undefined} />
            <Metric label="Receivables" value={formatInr(d.receivables.total)} note={Number(d.receivables.overdue) > 0 ? `${formatInr(d.receivables.overdue)} overdue` : 'None overdue'} noteTone={Number(d.receivables.overdue) > 0 ? 'bad' : 'good'} to={go('receivables:read', '/sales/receivables')} />
          </div>
          )}
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            <Card title={simple ? 'Sales by month' : 'Revenue and profit by month'} action={simple ? undefined : <span className="flex items-center gap-3 text-[11px] text-muted"><span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-brand/25" />Revenue</span><span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-good" />Profit</span></span>}><TrendChart rows={d.trend} profit={!simple} /></Card>
            <Card title="Needs attention" className="[&>div]:p-0">
              <Attention rows={simple ? [{ label: 'Customers who are overdue', count: Number(d.receivables.overdue) > 0 ? 1 : 0, to: go('receivables:read', '/sales/receivables'), amount: formatInr(d.receivables.overdue) }] : [
                { label: 'Waiting for your approval', count: d.attention.pendingApprovals, to: go('approvals:read', '/approvals') },
                { label: 'Supplier bills overdue', count: Number(d.payables.overdue) > 0 ? 1 : 0, to: go('payables:read', '/purchasing/payables'), amount: formatInr(d.payables.overdue) },
                { label: 'Bank lines to match', count: d.attention.unmatchedBankLines, to: go('bank:read', '/accounting/bank') },
                { label: 'Open purchase orders', count: d.attention.openPurchaseOrders, to: go('purchasing:read', '/purchasing/orders') },
                { label: 'Open work orders', count: d.attention.openWorkOrders, to: go('manufacturing:read', '/manufacturing/orders') },
              ]} />
            </Card>
          </div>
          <div className={simple ? 'grid grid-cols-1 items-start gap-4' : 'grid grid-cols-2 items-start gap-4'}>
            {simple ? null : <Card title="Position" className="[&>div]:p-0">
              <table className="w-full text-[13px]" aria-label="Position"><tbody className="divide-y divide-line/70">
                {d.cash.accounts.map((a) => <tr key={a.accountId}><td className="px-4 py-2 text-muted">{a.code} · {a.name}</td><td className="num px-4 py-2 text-right">{formatInr(a.balance)}</td></tr>)}
                <tr><td className="px-4 py-2 text-muted">Stock value</td><td className="num px-4 py-2 text-right">{formatInr(d.inventoryValue)}</td></tr>
                <tr><td className="px-4 py-2 text-muted">Payables</td><td className="num px-4 py-2 text-right">{formatInr(d.payables.total)}</td></tr>
              </tbody></table>
            </Card>}
            <Card title="Last months" className="[&>div]:p-0">
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-line bg-sunken text-left"><th className="eyebrow px-4 py-1.5">Month</th><th className="eyebrow num px-4 py-1.5 text-right">Revenue</th>{simple ? null : <th className="eyebrow num px-4 py-1.5 text-right">Profit</th>}</tr></thead>
                <tbody className="divide-y divide-line/70">
                  {[...d.trend].reverse().slice(0, 6).map((t) => (
                    <tr key={t.month}><td className="px-4 py-1.5">{MONTHS[Number(t.month.slice(5)) - 1]} {t.month.slice(0, 4)}</td><td className="num px-4 py-1.5 text-right">{formatInr(t.revenue)}</td>{simple ? null : <td className={`num px-4 py-1.5 text-right ${t.profit.startsWith('-') ? 'text-bad' : ''}`}>{formatInr(t.profit)}</td>}</tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}
