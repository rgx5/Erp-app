import { Printer } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '@/api/errors'
import { bridge } from '@/bridge'
import { useWorkspace } from '@/features/organization/workspace'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { Alert, Button, Spinner, TextField } from '@/ui/primitives'
import { dayEndHtml } from './dayEndHtml'
import { useDayEnd } from './queries'

const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' }

/** The end-of-day summary a shop owner checks before locking up: bills, returns, takings by mode and each shift's cash. */
export function DayEndPage() {
  const ws = useWorkspace()
  const [date, setDate] = useState(todayIso())
  const r = useDayEnd(ws.company?.id, date)
  const d = r.data
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Day-end report</h1>
        <Button variant="secondary" disabled={!d} onClick={() => d && void bridge.document.savePdf(dayEndHtml(d, ws.company?.legalName ?? ''), `day-end-${date}`)}><Printer className="size-4" aria-hidden /> {window.onesync ? 'Save as PDF' : 'Print'}</Button>
      </div>
      <div className="w-44"><TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      {r.error ? <Alert>{r.error instanceof ApiError ? r.error.message : 'Could not load the report.'}</Alert> : null}
      {r.isPending ? <Spinner /> : d ? (
        <>
          <div className="grid grid-cols-4 gap-3">
            {([['Bills', String(d.sales.bills)], ['Sales', formatInr(d.sales.total)], ['Returns', formatInr(d.returns.total)], ['Net sales', formatInr(d.netSales)]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface p-3"><div className="text-xs text-muted">{k}</div><div className="text-lg font-semibold">{v}</div></div>))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <section className="rounded-lg border border-line bg-surface p-3" aria-label="Takings by payment mode"><h2 className="mb-2 text-sm font-semibold">Takings by payment mode</h2>
              {d.byPaymentMode.length === 0 ? <p className="text-sm text-muted">No payments taken.</p> : <ul className="flex flex-col gap-1 text-sm">{d.byPaymentMode.map((p) => <li key={p.method} className="flex justify-between"><span>{METHOD[p.method] ?? p.method}</span><span>{formatInr(p.amount)}</span></li>)}</ul>}
              <p className="mt-2 text-xs text-muted">After refunds. Tax collected on sales: {formatInr(d.sales.tax)}.</p></section>
            <section className="rounded-lg border border-line bg-surface p-3" aria-label="Best sellers"><h2 className="mb-2 text-sm font-semibold">Best sellers</h2>
              {d.topItems.length === 0 ? <p className="text-sm text-muted">No sales.</p> : <ul className="flex flex-col gap-1 text-sm">{d.topItems.map((t) => <li key={t.label} className="flex justify-between"><span>{t.label}</span><span>{Number(t.quantity)} · {formatInr(t.net)}</span></li>)}</ul>}</section>
          </div>
          <section className="rounded-lg border border-line bg-surface p-3" aria-label="Shifts"><h2 className="mb-2 text-sm font-semibold">Shifts</h2>
            {d.shifts.length === 0 ? <p className="text-sm text-muted">No shifts on {formatDate(date)}.</p> : (
              <table className="w-full text-sm"><thead className="text-left text-muted"><tr><th className="py-1">Shift</th><th>Counter</th><th>Cashier</th><th className="text-right">Opening</th><th className="text-right">Expected</th><th className="text-right">Counted</th><th className="text-right">Over / short</th></tr></thead>
                <tbody>{d.shifts.map((s) => <tr key={s.id} className="border-t border-line"><td className="py-1">{s.shiftNo}{s.status === 'open' ? ' (open)' : ''}</td><td>{s.terminal}</td><td>{s.cashier ?? ''}</td><td className="text-right">{formatInr(s.openingCash, { symbol: false })}</td><td className="text-right">{s.expectedCash ? formatInr(s.expectedCash, { symbol: false }) : '–'}</td><td className="text-right">{s.countedCash ? formatInr(s.countedCash, { symbol: false }) : '–'}</td><td className="text-right">{s.variance ? formatInr(s.variance, { symbol: false }) : '–'}</td></tr>)}</tbody></table>)}
          </section>
        </>) : null}
    </div>
  )
}
