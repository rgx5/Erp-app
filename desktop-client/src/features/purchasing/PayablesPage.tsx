import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { PayablesAgeing } from '@/api/schemas'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { financialYearStart } from '@/domain/india'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, Card, Spinner, TextField } from '@/ui/primitives'
import { usePayablesAgeing, useSupplierPosition, useSupplierStatement } from './queries'

type Row = PayablesAgeing['suppliers'][number]

function SupplierPanel({ companyId, row, asOf, fyStart }: { companyId: string; row: Row; asOf: string; fyStart: string }) {
  const position = useSupplierPosition(companyId, row.supplierId, asOf)
  const [from, setFrom] = useState(fyStart)
  const statement = useSupplierStatement(companyId, row.supplierId, from, asOf)
  return (
    <div className="flex flex-col gap-5">
      {position.data ? (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Card><p className="text-xs text-muted">We owe</p><p className="num text-lg font-semibold">{formatInr(position.data.totalOutstanding)}</p></Card>
          <Card><p className="text-xs text-muted">Advance paid</p><p className="num text-lg font-semibold">{formatInr(position.data.totalUnapplied)}</p></Card>
          <Card><p className="text-xs text-muted">Balance</p><p className="num text-lg font-semibold">{formatInr(position.data.balance)}</p></Card>
        </div>
      ) : <Spinner />}
      <section aria-label="Open bills">
        <h3 className="mb-1 text-sm font-semibold">Open bills</h3>
        <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Bill</th><th className="py-1">Date</th><th className="py-1">Due</th><th className="num py-1 text-right">Outstanding</th><th className="num py-1 text-right">Overdue days</th></tr></thead>
          <tbody>{position.data?.openBills.map((b) => <tr key={b.id} className="border-t border-line/60"><td className="py-1.5"><Link to="/purchasing/bills/$billId" params={{ billId: b.id }} className="underline">{b.number}</Link></td><td className="py-1.5">{formatDate(b.date)}</td><td className="py-1.5">{b.dueDate ? formatDate(b.dueDate) : ''}</td><td className="num py-1.5 text-right">{formatInr(b.outstanding)}</td><td className="num py-1.5 text-right">{b.daysOverdue > 0 ? b.daysOverdue : ''}</td></tr>)}</tbody></table>
      </section>
      <section aria-label="Statement">
        <div className="mb-2 flex items-end justify-between"><h3 className="text-sm font-semibold">Statement</h3><div className="flex items-end gap-2"><div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <Button variant="secondary" disabled={!statement.data} onClick={() => statement.data && download(`supplier-statement-${row.supplierName.replace(/\W+/g, '_')}.csv`, toCsv(['Date', 'Document', 'Number', 'Debit', 'Credit', 'Balance'], [['', 'Opening balance', '', '', '', statement.data.openingBalance], ...statement.data.lines.map((l) => [l.date, l.kind, l.number, l.debit, l.credit, l.balance]), ['', 'Closing balance', '', '', '', statement.data.closingBalance]]))}>Export CSV</Button></div></div>
        {statement.isPending ? <Spinner /> : statement.error ? <Alert>{statement.error.message}</Alert> : (
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Date</th><th className="py-1">Document</th><th className="num py-1 text-right">Paid</th><th className="num py-1 text-right">Billed</th><th className="num py-1 text-right">Balance</th></tr></thead>
            <tbody>
              <tr className="border-t border-line/60 text-muted"><td className="py-1.5" colSpan={4}>Opening balance</td><td className="num py-1.5 text-right">{formatInr(statement.data?.openingBalance ?? '0')}</td></tr>
              {statement.data?.lines.map((l, i) => <tr key={i} className="border-t border-line/60"><td className="py-1.5">{formatDate(l.date)}</td><td className="py-1.5">{l.number}</td><td className="num py-1.5 text-right">{Number(l.debit) ? formatInr(l.debit, { symbol: false }) : ''}</td><td className="num py-1.5 text-right">{Number(l.credit) ? formatInr(l.credit, { symbol: false }) : ''}</td><td className="num py-1.5 text-right">{formatInr(l.balance, { symbol: false })}</td></tr>)}
              <tr className="border-t border-line font-medium"><td className="py-1.5" colSpan={4}>Closing balance</td><td className="num py-1.5 text-right">{formatInr(statement.data?.closingBalance ?? '0')}</td></tr>
            </tbody></table>
        )}
      </section>
    </div>
  )
}

export function PayablesPage() {
  const ws = useWorkspace()
  const [asOf, setAsOf] = useState(todayIso())
  const ageing = usePayablesAgeing(ws.company?.id, asOf)
  const [open, setOpen] = useState<Row | null>(null)
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    const money = (key: keyof Row, header: string): ColumnDef<Row, unknown> => ({ header, accessorFn: (r) => (Number(r[key]) ? formatInr(String(r[key]), { symbol: false }) : ''), size: 110, meta: { align: 'right' } })
    return [{ header: 'Supplier', accessorKey: 'supplierName', size: 260 }, money('current', 'Not due'), money('days1to30', '1-30 days'), money('days31to60', '31-60'), money('days61to90', '61-90'), money('over90', 'Over 90'), money('total', 'Total'), money('unapplied', 'Advance')]
  }, [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const t = ageing.data?.totals
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <h1 className="text-lg font-semibold">Payables</h1>
        <div className="flex items-end gap-2"><div className="w-40"><TextField label="As of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
          <Button variant="secondary" disabled={!ageing.data} onClick={() => ageing.data && download('payables-ageing.csv', toCsv(['Supplier', 'Not due', '1-30', '31-60', '61-90', 'Over 90', 'Total', 'Advance'], ageing.data.suppliers.map((c) => [c.supplierName, c.current, c.days1to30, c.days31to60, c.days61to90, c.over90, c.total, c.unapplied])))}>Export CSV</Button></div>
      </div>
      {ageing.error ? <Alert>{ageing.error.message}</Alert> : null}
      {t ? <p className="text-sm text-muted" role="status">Total payable <b className="text-ink">{formatInr(t.total)}</b> · not yet due {formatInr(t.current)} · overdue {formatInr(String(Number(t.total) - Number(t.current)))}</p> : null}
      {ageing.isPending ? <Spinner /> : <DataTable columns={columns} rows={ageing.data?.suppliers ?? []} rowKey={(r) => r.supplierId} onOpen={setOpen} empty="You owe nothing as of this date." />}
      {open ? <Drawer title={open.supplierName} onClose={() => setOpen(null)} width={720}><SupplierPanel companyId={ws.company.id} row={open} asOf={asOf} fyStart={financialYearStart(asOf, ws.company.fiscalYearStartMonth)} /></Drawer> : null}
    </div>
  )
}
