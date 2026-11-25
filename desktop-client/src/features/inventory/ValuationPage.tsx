import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import type { Valuation } from '@/api/schemas'
import { formatInr, todayIso } from '@/domain/format'
import { showQty } from '@/domain/quantity'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Alert, Button, Card, Spinner, TextField } from '@/ui/primitives'
import { useInventoryReconciliation, useValuation } from './queries'

type Row = Valuation['rows'][number]

export function ValuationPage() {
  const ws = useWorkspace()
  const [asOf, setAsOf] = useState(todayIso())
  const valuation = useValuation(ws.company?.id, asOf)
  const recon = useInventoryReconciliation(ws.company?.id, asOf)
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => [
    { header: 'Item', accessorFn: (r) => `${r.itemCode} · ${r.itemName}`, size: 300 }, { header: 'Warehouse', accessorKey: 'warehouseCode', size: 110 },
    { header: 'Quantity', accessorFn: (r) => showQty(r.quantity), size: 100, meta: { align: 'right' } }, { header: 'Average cost', accessorFn: (r) => formatInr(r.averageCost), size: 120, meta: { align: 'right' } }, { header: 'Value', accessorFn: (r) => formatInr(r.value), size: 130, meta: { align: 'right' } },
  ], [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const r = recon.data
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Stock valuation</h1>
        <div className="filterbar"><div className="w-40"><TextField label="As of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
          <Button variant="secondary" disabled={!valuation.data} onClick={() => valuation.data && download('stock-valuation.csv', toCsv(['Item code', 'Item', 'Warehouse', 'Quantity', 'Average cost', 'Value'], valuation.data.rows.map((x) => [x.itemCode, x.itemName, x.warehouseCode, x.quantity, x.averageCost, x.value])))}>Export CSV</Button></div>
      </div>
      {r ? (
        <Card title="Stock against the books">
          <p className={`text-sm ${r.reconciled ? 'text-good' : 'text-bad'}`} role="status">{r.reconciled ? 'The stock records agree with the inventory accounts.' : `The stock records differ from the inventory accounts by ${formatInr(r.difference)}.`}</p>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Account</th><th className="num py-1 text-right">Stock records</th><th className="num py-1 text-right">Ledger</th><th className="num py-1 text-right">Difference</th></tr></thead>
            <tbody>
              {r.rows.filter((x) => Number(x.stockValue) !== 0 || Number(x.glBalance) !== 0).map((x) => <tr key={x.accountId} className="border-t border-line/60"><td className="py-1.5">{x.code} · {x.name}</td><td className="num py-1.5 text-right">{formatInr(x.stockValue, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(x.glBalance, { symbol: false })}</td><td className={`num py-1.5 text-right ${x.reconciled ? '' : 'text-bad'}`}>{formatInr(x.difference, { symbol: false })}</td></tr>)}
              <tr className="border-t border-line font-medium"><td className="py-1.5">Total</td><td className="num py-1.5 text-right">{formatInr(r.stockTotal)}</td><td className="num py-1.5 text-right">{formatInr(r.glTotal)}</td><td className="num py-1.5 text-right">{formatInr(r.difference)}</td></tr>
            </tbody>
          </table>
        </Card>
      ) : null}
      {valuation.error ? <Alert>{valuation.error.message}</Alert> : null}
      {valuation.isPending ? <Spinner /> : <DataTable columns={columns} rows={valuation.data?.rows ?? []} rowKey={(x) => `${x.warehouseCode}:${x.itemId}`} empty="No stock on this date." height={420} />}
      {valuation.data ? <p className="text-sm text-muted">Total value <b className="text-ink">{formatInr(valuation.data.totalValue)}</b></p> : null}
    </div>
  )
}
