import type { ColumnDef } from '@tanstack/react-table'
import { Download, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { StockBalance } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { sum } from '@/domain/money'
import { financialYearStart } from '@/domain/india'
import { showQty } from '@/domain/quantity'
import { isValid } from '@/domain/money'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { isBlankStock, newStockLine, StockLines, type StockLine } from './StockLines'
import { usePostMovement, useStockBalances, useStockCard } from './queries'

const qtyOk = (v: string): boolean => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0

function CardDrawer({ companyId, row, from, to, onClose }: { companyId: string; row: StockBalance; from: string; to: string; onClose: () => void }) {
  const card = useStockCard(companyId, row.itemId, row.warehouseId, from, to)
  return (
    <Drawer title={`${row.itemCode} · ${row.itemName} in ${row.warehouseCode}`} onClose={onClose} width={720}>
      {card.isPending ? <Spinner /> : card.error ? <Alert>{card.error.message}</Alert> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1">Date</th><th className="py-1">Document</th><th className="py-1">What</th><th className="num py-1 text-right">Qty</th><th className="num py-1 text-right">Cost</th><th className="num py-1 text-right">Value</th><th className="num py-1 text-right">Balance</th></tr></thead>
          <tbody>
            {(card.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-line/60"><td className="py-1.5">{formatDate(r.postingDate)}</td><td className="py-1.5">{r.movementNo}</td><td className="py-1.5">{r.description}</td><td className={`num py-1.5 text-right ${r.quantity.startsWith('-') ? 'text-bad' : ''}`}>{showQty(r.quantity)}</td><td className="num py-1.5 text-right">{formatInr(r.unitCost, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(r.value, { symbol: false })}</td><td className="num py-1.5 text-right">{showQty(r.balanceQuantity)}</td></tr>
            ))}
            {(card.data ?? []).length === 0 ? <tr><td colSpan={7} className="py-3 text-center text-muted">No movements in this period.</td></tr> : null}
          </tbody>
        </table>
      )}
    </Drawer>
  )
}

function AdjustDrawer({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const post = usePostMovement()
  const flash = useFlash()
  const [warehouseId, setWarehouseId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<StockLine[]>([newStockLine()])
  const [problem, setProblem] = useState<string | null>(null)
  const wh = warehouseId || ws.warehouses[0]?.id || ''
  const filled = lines.filter((l) => !isBlankStock(l))
  const ready = ws.company && wh && reason.trim() && filled.length > 0 && filled.every((l) => l.item && qtyOk(l.quantity) && (l.direction === 'out' || isValid(l.unitCost)))
  const key = useMemo(() => crypto.randomUUID(), [wh, date, reason, JSON.stringify(lines.map((l) => [l.item?.id, l.quantity, l.direction, l.unitCost]))]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!ready || !ws.company) return
    setProblem(null)
    try {
      const m = await post.mutateAsync({ key, body: { companyId: ws.company.id, movementType: 'adjustment', postingDate: date, description: reason.trim(), lines: filled.map((l) => ({ warehouseId: wh, itemId: (l.item as { id: string }).id, quantity: l.quantity, direction: l.direction, ...(l.direction === 'in' ? { unitCost: l.unitCost } : {}) })) } })
      flash.show(`${m.movementNo} posted. Stock and the books are updated.`)
      onClose()
    } catch (e) { setProblem(e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : 'Could not post the adjustment.') }
  }
  return (
    <Drawer title="Adjust stock" onClose={onClose} width={680}>
      <div className="flex flex-col gap-4">
        <Alert tone="info">Use this for damage, loss, found stock or corrections. Taking stock out is costed by the item's valuation method; putting stock in needs its cost. Each adjustment posts to the books.</Alert>
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Warehouse" value={wh} onChange={(e) => setWarehouseId(e.target.value)} options={ws.warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} hint="For example: damaged in transit" />
        <StockLines lines={lines} onChange={setLines} withDirection withCost />
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={post.isPending} disabled={!ready} onClick={() => void submit()}>Post adjustment</Button>
      </div>
    </Drawer>
  )
}

export function StockPage() {
  const ws = useWorkspace()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'stock:post')
  const [warehouseId, setWarehouseId] = useState('')
  const [search, setSearch] = useState('')
  const balances = useStockBalances(ws.company?.id, warehouseId || undefined)
  const [open, setOpen] = useState<StockBalance | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  const rows = useMemo(() => (balances.data ?? []).filter((b) => !search.trim() || `${b.itemCode} ${b.itemName}`.toLowerCase().includes(search.trim().toLowerCase())), [balances.data, search])
  const columns = useMemo<ColumnDef<StockBalance, unknown>[]>(() => [
    { header: 'Item', accessorFn: (b) => `${b.itemCode} · ${b.itemName}`, size: 300 }, { header: 'Warehouse', accessorKey: 'warehouseCode', size: 110 },
    { header: 'On hand', accessorFn: (b) => showQty(b.quantity), size: 100, meta: { align: 'right' } }, { header: 'Average cost', accessorFn: (b) => formatInr(b.averageCost), size: 120, meta: { align: 'right' } },
    { header: 'Value', accessorFn: (b) => formatInr(b.value), size: 130, meta: { align: 'right' } }, { header: 'Method', accessorFn: (b) => (b.costingMethod === 'fifo' ? 'FIFO' : 'Weighted average'), size: 140 },
  ], [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const total = sum(rows.map((r) => r.value))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Stock on hand</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => download('stock-on-hand.csv', toCsv(['Item code', 'Item', 'Warehouse', 'On hand', 'Average cost', 'Value', 'Method'], rows.map((r) => [r.itemCode, r.itemName, r.warehouseCode, r.quantity, r.averageCost, r.value, r.costingMethod])))}><Download className="size-4" aria-hidden /> Export</Button>
          {canPost ? <Button onClick={() => setAdjusting(true)}><SlidersHorizontal className="size-4" aria-hidden /> Adjust stock</Button> : null}
        </div>
      </div>
      <Toolbar>
        <div className="w-72"><TextField label="Search" placeholder="Item code or name" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-56"><SelectField label="Warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} options={[{ value: '', label: 'All warehouses' }, ...ws.warehouses.map((w) => ({ value: w.id, label: w.name }))]} /></div>
      </Toolbar>
      {balances.error ? <Alert>{balances.error.message}</Alert> : null}
      {balances.isPending ? <Spinner /> : <DataTable columns={columns} rows={rows} rowKey={(b) => `${b.warehouseId}:${b.itemId}`} onOpen={setOpen} empty="No stock yet. Receive goods or post opening stock." height={520} />}
      {balances.data ? <p className="text-sm text-muted" role="status">{rows.length} line{rows.length === 1 ? '' : 's'} · total value <b className="text-ink">{formatInr(total)}</b></p> : null}
      {open ? <CardDrawer companyId={ws.company.id} row={open} from={financialYearStart(todayIso(), ws.company.fiscalYearStartMonth)} to={todayIso()} onClose={() => setOpen(null)} /> : null}
      {adjusting ? <AdjustDrawer onClose={() => setAdjusting(false)} /> : null}
    </div>
  )
}
