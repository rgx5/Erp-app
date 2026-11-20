import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import { useCategories } from '@/features/masterdata/queries'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { formatInr, todayIso } from '@/domain/format'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { GROUP_LABELS, useSalesReport, type GroupBy } from './queries'

const monthStart = (): string => `${todayIso().slice(0, 8)}01`
const n = (v: string): string => formatInr(v, { symbol: false })

/** Sales by item, category, brand, day, cashier or customer, with profit where the cost of what was sold is known. */
export function SalesAnalysisPage() {
  const ws = useWorkspace()
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(todayIso())
  const [groupBy, setGroupBy] = useState<GroupBy>('item'); const [categoryId, setCategoryId] = useState('')
  const categories = useCategories()
  const r = useSalesReport({ companyId: ws.company?.id, from, to, groupBy, ...(categoryId ? { categoryId } : {}) })
  const rows = useMemo(() => r.data?.rows ?? [], [r.data])
  const exportCsv = () => { if (!r.data) return; download(`sales-by-${groupBy}-${from}-to-${to}.csv`, toCsv([GROUP_LABELS[groupBy], 'Quantity', 'Sales (before tax)', 'Tax', 'Total', 'Cost', 'Profit', 'Margin %'], [...rows.map((x) => [x.label, x.quantity, x.net, x.tax, x.total, x.cost, x.profit, x.marginPercent ?? '']), ['Total', '', r.data.totals.net, r.data.totals.tax, r.data.totals.total, r.data.totals.cost, r.data.totals.profit, '']])) }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Sales analysis</h1><Button variant="secondary" disabled={!rows.length} onClick={exportCsv}><Download className="size-4" aria-hidden /> Export CSV</Button></div>
      <Toolbar>
        <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="w-44"><SelectField label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} options={Object.entries(GROUP_LABELS).map(([value, label]) => ({ value, label }))} /></div>
        <div className="w-48"><SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={[{ value: '', label: 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} /></div>
      </Toolbar>
      {from > to ? <Alert>The start date is after the end date.</Alert> : null}
      {r.error ? <Alert>{r.error instanceof ApiError ? r.error.message : 'Could not load the report.'}</Alert> : null}
      {r.isPending && from <= to ? <Spinner /> : r.data ? (
        <>
          <div className="grid grid-cols-4 gap-3">
            {([['Sales (before tax)', r.data.totals.net], ['Tax', r.data.totals.tax], ['Total billed', r.data.totals.total], ['Profit', r.data.totals.profit]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface p-3"><div className="text-xs text-muted">{k}</div><div className="text-lg font-semibold">{formatInr(v)}</div></div>))}
          </div>
          <div className="max-h-[56vh] overflow-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm" aria-label="Sales analysis">
              <thead className="sticky top-0 bg-sunken text-left"><tr><th className="px-3 py-2">{GROUP_LABELS[groupBy]}</th>{['Quantity', 'Sales', 'Tax', 'Total', 'Profit', 'Margin'].map((h) => <th key={h} className="px-3 py-2 text-right">{h}</th>)}</tr></thead>
              <tbody>{rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">No sales in this period.</td></tr> : rows.map((x) => (
                <tr key={x.key || x.label} className="border-t border-line"><td className="px-3 py-1.5">{x.label}</td><td className="px-3 py-1.5 text-right">{Number(x.quantity)}</td><td className="px-3 py-1.5 text-right">{n(x.net)}</td><td className="px-3 py-1.5 text-right">{n(x.tax)}</td><td className="px-3 py-1.5 text-right">{n(x.total)}</td><td className="px-3 py-1.5 text-right">{Number(x.cost) === 0 ? '–' : n(x.profit)}</td><td className="px-3 py-1.5 text-right">{x.marginPercent ? `${x.marginPercent}%` : '–'}</td></tr>))}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Returns and credit notes are taken off. Profit is sales before tax less the cost recorded when the stock was sold; it shows a dash where no cost is known (services, for instance).</p>
        </>) : null}
    </div>
  )
}
