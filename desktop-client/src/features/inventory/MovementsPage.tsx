import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import type { MovementHeader } from '@/api/schemas'
import { formatDate, formatInr } from '@/domain/format'
import { showQty } from '@/domain/quantity'
import { useItemsById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { Alert, SelectField, Spinner, TextField, Toolbar, Button } from '@/ui/primitives'
import { useMovement, useMovements } from './queries'

export const MOVEMENT_TYPES: Record<string, string> = { opening: 'Opening stock', receipt: 'Receipt', issue: 'Issue', adjustment: 'Adjustment', transfer_dispatch: 'Transfer out', transfer_receipt: 'Transfer in', transfer_direct: 'Transfer', count: 'Stock count', revaluation: 'Revaluation' }

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace()
  const q = useMovement(id)
  const items = useItemsById((q.data?.lines ?? []).map((l) => l.itemId))
  const wh = (wid: string): string => ws.warehouses.find((w) => w.id === wid)?.code ?? ''
  return (
    <Drawer title={q.data?.movementNo ?? 'Stock movement'} onClose={onClose} width={680}>
      {q.isPending ? <Spinner /> : !q.data ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{MOVEMENT_TYPES[q.data.movementType] ?? q.data.movementType} · {formatDate(q.data.postingDate)} · {q.data.description}</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="py-1">Warehouse</th><th className="num py-1 text-right">Qty</th><th className="num py-1 text-right">Cost</th><th className="num py-1 text-right">Value</th><th className="num py-1 text-right">Balance</th></tr></thead>
            <tbody>{q.data.lines.map((l) => <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{items.data?.get(l.itemId)?.code} · {items.data?.get(l.itemId)?.name}</td><td className="py-1.5">{wh(l.warehouseId)}</td><td className={`num py-1.5 text-right ${l.quantity.startsWith('-') ? 'text-bad' : ''}`}>{showQty(l.quantity)}</td><td className="num py-1.5 text-right">{formatInr(l.unitCost, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(l.value, { symbol: false })}</td><td className="num py-1.5 text-right">{showQty(l.balanceQuantity)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Drawer>
  )
}

export function MovementsPage() {
  const ws = useWorkspace()
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const list = useMovements(ws.company?.id, { ...(type ? { movementType: type } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })
  const [open, setOpen] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<MovementHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'movementNo', size: 150 }, { header: 'Date', accessorFn: (m) => formatDate(m.postingDate), size: 100 },
    { header: 'Type', accessorFn: (m) => MOVEMENT_TYPES[m.movementType] ?? m.movementType, size: 140 }, { header: 'Description', accessorKey: 'description', size: 380 },
  ], [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Stock movements</h1>
      <Toolbar>
        <div className="w-48"><SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All' }, ...Object.entries(MOVEMENT_TYPES).map(([value, label]) => ({ value, label }))]} /></div>
        <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(m) => m.id} onOpen={(m) => setOpen(m.id)} empty="No movements yet." height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {open ? <Detail id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}
