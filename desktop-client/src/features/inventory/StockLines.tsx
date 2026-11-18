import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Item } from '@/api/schemas'
import { ItemPicker } from '@/features/masterdata/ItemPicker'
import { useBatches } from './trackingQueries'
import { Button } from '@/ui/primitives'

export interface StockLine { key: string; item: Item | null; quantity: string; direction: 'in' | 'out'; unitCost: string; batchId: string; newBatchNo: string; newExpiry: string; serials: string }
let n = 0
export const newStockLine = (): StockLine => ({ key: `s${++n}`, item: null, quantity: '', direction: 'out', unitCost: '', batchId: '', newBatchNo: '', newExpiry: '', serials: '' })

const serialList = (v: string): string[] => v.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)
/** What a tracked item adds to a movement line: an existing batch, a new batch (goods coming in), or its serial numbers. */
export function trackingPayload(l: StockLine, incoming: boolean): Record<string, unknown> {
  if (l.item?.tracking === 'serial') return { serialNos: serialList(l.serials) }
  if (l.item?.tracking === 'batch') return incoming && !l.batchId ? { batch: { batchNo: l.newBatchNo.trim(), ...(l.newExpiry ? { expiryDate: l.newExpiry } : {}) } } : { batchId: l.batchId }
  return {}
}
/** Why a tracked line is not complete yet, or null when it is. */
export function trackingProblem(l: StockLine, incoming: boolean): string | null {
  if (l.item?.tracking === 'serial') { const list = serialList(l.serials); return list.length === Number(l.quantity) && new Set(list).size === list.length ? null : `${l.item.code}: enter exactly ${l.quantity || 'as many'} different serial numbers` }
  if (l.item?.tracking === 'batch') return l.batchId || (incoming && l.newBatchNo.trim()) ? null : `${l.item.code}: choose ${incoming ? 'or name' : ''} a batch`
  return null
}

function TrackingRow({ line, incoming, patch }: { line: StockLine; incoming: boolean; patch: (p: Partial<StockLine>) => void }) {
  const item = line.item as Item
  const batches = useBatches(item.tracking === 'batch' ? item.id : undefined)
  if (item.tracking === 'serial') return <label className="flex flex-col gap-1 text-xs font-medium text-muted">Serial numbers (one per line or comma separated)<textarea aria-label={`Serial numbers for ${item.code}`} rows={2} className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink" value={line.serials} onChange={(e) => patch({ serials: e.target.value })} /></label>
  return (
    <div className="grid grid-cols-3 items-end gap-2">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">Batch<select aria-label={`Batch for ${item.code}`} className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" value={line.batchId} onChange={(e) => patch({ batchId: e.target.value })}><option value="">{incoming ? 'New batch…' : 'Choose…'}</option>{(batches.data ?? []).filter((b) => b.status === 'active').map((b) => <option key={b.id} value={b.id}>{b.batchNo}{b.expiryDate ? ` (expires ${b.expiryDate})` : ''}</option>)}</select></label>
      {incoming && !line.batchId ? <><label className="flex flex-col gap-1 text-xs font-medium text-muted">New batch number<input aria-label={`New batch number for ${item.code}`} className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" value={line.newBatchNo} onChange={(e) => patch({ newBatchNo: e.target.value })} /></label><label className="flex flex-col gap-1 text-xs font-medium text-muted">Expires (optional)<input type="date" aria-label={`Expiry for ${item.code}`} className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" value={line.newExpiry} onChange={(e) => patch({ newExpiry: e.target.value })} /></label></> : null}
    </div>
  )
}
export const isBlankStock = (l: StockLine): boolean => l.item === null && l.quantity === ''

/** Rows of item + quantity (+ direction and cost for adjustments). Items are found by typing; stocked items only. */
export function StockLines({ lines, onChange, withDirection, withCost }: { lines: StockLine[]; onChange: (l: StockLine[]) => void; withDirection?: boolean; withCost?: boolean }) {
  const [resets, setResets] = useState<Record<string, number>>({})
  const patch = (key: string, p: Partial<StockLine>): void => onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)))
  return (
    <div className="flex flex-col gap-2" role="table" aria-label="Stock lines">
      {lines.map((l) => (
        <div key={`${l.key}-${resets[l.key] ?? 0}`} className="flex flex-col gap-1">
        <div role="row" className="grid items-end gap-2" style={{ gridTemplateColumns: `1fr ${withDirection ? '110px ' : ''}100px ${withCost ? '110px ' : ''}32px` }}>
          <ItemPicker label="Item" onPick={(item) => patch(l.key, { item })} />
          {withDirection ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">Direction
              <select aria-label="Direction" className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" value={l.direction} onChange={(e) => patch(l.key, { direction: e.target.value as 'in' | 'out' })}><option value="out">Take out</option><option value="in">Put in</option></select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">Quantity
            <input aria-label="Quantity" inputMode="decimal" className="h-9 rounded-md border border-line bg-surface px-2 text-right text-sm text-ink" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} />
          </label>
          {withCost ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">Cost each
              <input aria-label="Cost each" inputMode="decimal" disabled={withDirection && l.direction === 'out'} className="h-9 rounded-md border border-line bg-surface px-2 text-right text-sm text-ink disabled:opacity-50" value={l.unitCost} onChange={(e) => patch(l.key, { unitCost: e.target.value })} />
            </label>
          ) : null}
          <button type="button" aria-label="Remove line" className="mb-1 grid size-7 place-items-center rounded text-muted hover:bg-canvas hover:text-bad" onClick={() => { if (lines.length > 1) onChange(lines.filter((x) => x.key !== l.key)); else { onChange([newStockLine()]); setResets({ ...resets, [l.key]: (resets[l.key] ?? 0) + 1 }) } }}><Trash2 className="size-4" /></button>
        </div>
        {l.item && l.item.tracking !== 'none' ? <TrackingRow line={l} incoming={withDirection ? l.direction === 'in' : false} patch={(p) => patch(l.key, p)} /> : null}
        </div>
      ))}
      <Button variant="ghost" className="self-start" onClick={() => onChange([...lines, newStockLine()])}>+ Add line</Button>
    </div>
  )
}
