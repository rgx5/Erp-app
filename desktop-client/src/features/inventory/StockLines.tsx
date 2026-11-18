import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Item } from '@/api/schemas'
import { ItemPicker } from '@/features/masterdata/ItemPicker'
import { Button } from '@/ui/primitives'

export interface StockLine { key: string; item: Item | null; quantity: string; direction: 'in' | 'out'; unitCost: string }
let n = 0
export const newStockLine = (): StockLine => ({ key: `s${++n}`, item: null, quantity: '', direction: 'out', unitCost: '' })
export const isBlankStock = (l: StockLine): boolean => l.item === null && l.quantity === ''

/** Rows of item + quantity (+ direction and cost for adjustments). Items are found by typing; stocked items only. */
export function StockLines({ lines, onChange, withDirection, withCost }: { lines: StockLine[]; onChange: (l: StockLine[]) => void; withDirection?: boolean; withCost?: boolean }) {
  const [resets, setResets] = useState<Record<string, number>>({})
  const patch = (key: string, p: Partial<StockLine>): void => onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)))
  return (
    <div className="flex flex-col gap-2" role="table" aria-label="Stock lines">
      {lines.map((l) => (
        <div key={`${l.key}-${resets[l.key] ?? 0}`} role="row" className="grid items-end gap-2" style={{ gridTemplateColumns: `1fr ${withDirection ? '110px ' : ''}100px ${withCost ? '110px ' : ''}32px` }}>
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
      ))}
      <Button variant="ghost" className="self-start" onClick={() => onChange([...lines, newStockLine()])}>+ Add line</Button>
    </div>
  )
}
