import { Link } from '@tanstack/react-router'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'

interface Report { to: string; name: string; what: string; needs: string }
const GROUPS: { title: string; reports: Report[] }[] = [
  { title: 'Financial statements', reports: [
    { to: '/accounting/reports', name: 'Trial balance', what: 'Every account with opening, movement and closing; click through to its ledger. CSV.', needs: 'accounting:read' },
    { to: '/accounting/reports', name: 'Profit and loss, balance sheet, cash flow', what: 'Schedule III statements for any period. CSV.', needs: 'accounting:read' },
    { to: '/accounting/journals', name: 'Journal entries', what: 'Every posting with its lines, filtered by type and date.', needs: 'accounting:read' },
    { to: '/accounting/bank', name: 'Bank reconciliation statement', what: 'Books against the bank statement, with what is still to clear.', needs: 'bank:read' },
  ] },
  { title: 'GST', reports: [
    { to: '/gst', name: 'GSTR-1', what: 'Outward supplies by section with HSN summary and documents issued. GSTN JSON, HSN CSV.', needs: 'gst:read' },
    { to: '/gst', name: 'GSTR-3B', what: 'Summary return with input credit and how the tax is paid. GSTN JSON.', needs: 'gst:read' },
    { to: '/gst', name: 'ITC register', what: 'Input credit on each bill, available and blocked. CSV.', needs: 'gst:read' },
    { to: '/gst', name: 'CMP-08', what: 'Quarterly statement for composition dealers. GSTN JSON.', needs: 'gst:read' },
  ] },
  { title: 'Sales and purchases', reports: [
    { to: '/sales/analysis', name: 'Sales analysis and profit', what: 'Sales by item, category, brand, day, cashier or customer, with profit. CSV.', needs: 'sales:read' },
    { to: '/pos/day-end', name: 'Day-end report', what: 'Bills, returns, takings by payment mode and each shift’s cash, printable on a till roll.', needs: 'pos:read' },
    { to: '/sales/receivables', name: 'Receivables ageing and customer statements', what: 'Who owes you, how overdue, and statements to send. CSV.', needs: 'sales:read' },
    { to: '/purchasing/payables', name: 'Payables ageing and supplier statements', what: 'What you owe, by supplier and age. CSV.', needs: 'purchasing:read' },
  ] },
  { title: 'Stock', reports: [
    { to: '/inventory/stock', name: 'Stock on hand and stock card', what: 'Quantity and value by warehouse; each item’s history. CSV.', needs: 'stock:read' },
    { to: '/inventory/valuation', name: 'Valuation', what: 'Stock value checked against the inventory accounts. CSV.', needs: 'stock:read' },
    { to: '/inventory/movements', name: 'Stock movements', what: 'Every receipt, issue, transfer and adjustment.', needs: 'stock:read' },
  ] },
]

export function ReportCentrePage() {
  const perms = useSession((s) => s.me?.permissions ?? [])
  return (
    <div className="flex flex-col gap-6">
      <h1 className="page-title">Report centre</h1>
      {GROUPS.map((g) => {
        const shown = g.reports.filter((r) => can(perms, r.needs))
        return shown.length === 0 ? null : (
          <section key={g.title} className="flex flex-col gap-2"><h2 className="text-sm font-semibold text-muted">{g.title}</h2>
            <div className="grid grid-cols-2 gap-3">{shown.map((r) => <Link key={r.name} to={r.to} className="rounded-lg border border-line bg-surface p-3 hover:border-brand"><div className="font-medium">{r.name}</div><div className="mt-0.5 text-sm text-muted">{r.what}</div></Link>)}</div>
          </section>
        )
      })}
    </div>
  )
}
