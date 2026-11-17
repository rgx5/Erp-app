import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Item, Warehouse } from '@/api/schemas'
import { formatInr } from '@/domain/format'
import { useDebounced } from '@/ui/hooks'
import { cn } from '@/ui/cn'
import { useItems } from '@/features/masterdata/queries'

export interface Line {
  key: string
  item: Item | null
  description: string
  quantity: string
  unitPrice: string
  discountPercent: string
  taxInclusive: boolean
  warehouseId: string
}
let counter = 0
export const emptyLine = (warehouseId = ''): Line => ({ key: `l${++counter}`, item: null, description: '', quantity: '1', unitPrice: '', discountPercent: '0', taxInclusive: false, warehouseId })
export const isBlank = (l: Line): boolean => l.item === null && l.unitPrice === ''

const cell = 'h-8 w-full rounded border border-transparent bg-transparent px-2 text-sm outline-none hover:border-line focus:border-brand focus:bg-surface focus:ring-1 focus:ring-brand/40'

/** The cell where an item is found by typing; arrow keys and Enter choose from the short list. */
function ItemCell({ line, onPick, onClear, autoFocus }: { line: Line; onPick: (item: Item) => void; onClear: () => void; autoFocus: boolean }) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const q = useDebounced(text.trim(), 200)
  const list = useItems({ ...(q ? { q } : {}), status: 'active' })
  const options = (list.rows.filter((i) => i.isSellable)).slice(0, 8)
  const open = line.item === null && text.trim().length > 0
  // Enter pressed before the results arrived (a fast typist or a barcode scanner): choose the first result as soon as it is there
  const [wantFirst, setWantFirst] = useState(false)
  const settled = q === text.trim() && !list.isFetching
  useEffect(() => {
    if (!wantFirst || !settled) return
    setWantFirst(false)
    const first = options[0]
    if (first) { onPick(first); setText('') }
  }, [wantFirst, settled, options, onPick])

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (options[active] && settled) { onPick(options[active] as Item); setText('') } else setWantFirst(true) }
    else if (e.key === 'Escape') setText('')
  }
  return (
    <div className="relative">
      <input
        aria-label="Item" className={cell} placeholder="Type to find an item" autoComplete="off" autoFocus={autoFocus}
        value={line.item ? `${line.item.code} · ${line.item.name}` : text}
        onChange={(e) => { if (line.item) onClear(); setText(e.target.value); setActive(0) }} onKeyDown={onKey}
      />
      {open ? (
        <ul role="listbox" aria-label="Item results" className="absolute left-0 top-full z-30 mt-1 max-h-56 w-[28rem] overflow-auto rounded-md border border-line bg-surface text-sm shadow-lg">
          {options.map((i, n) => (
            <li key={i.id}><button type="button" role="option" aria-selected={n === active} className={cn('flex w-full justify-between px-3 py-1.5 text-left', n === active ? 'bg-canvas' : '')} onMouseDown={(e) => { e.preventDefault(); onPick(i); setText('') }}><span>{i.code} · {i.name}</span><span className="text-muted">{i.hsnSacCode ?? ''}</span></button></li>
          ))}
          {!list.isPending && options.length === 0 ? <li className="px-3 py-2 text-muted">No sellable item matches.</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The invoice lines: a keyboard-first grid. Enter moves right and then down; Enter on the last cell of the last row adds a row;
 * the arrow keys choose in the item list. Amounts shown beside each line come from the server (`computed`), not from this screen.
 */
export function LineGrid({ lines, onChange, warehouses, computed, readOnly }: {
  lines: Line[]
  onChange: (lines: Line[]) => void
  warehouses: Warehouse[]
  computed: { taxableValue: string; lineTotal: string }[] | undefined
  readOnly?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  useEffect(() => { if (focusKey) setFocusKey(null) }, [focusKey])
  const patch = (key: string, p: Partial<Line>): void => onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)))

  function enter(e: KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const inputs = [...(root.current?.querySelectorAll<HTMLInputElement>('input[data-nav]') ?? [])]
    const at = inputs.indexOf(e.currentTarget)
    const next = inputs[at + 1]
    if (next) { next.focus(); next.select?.(); return }
    if (!isBlank(lines[index] as Line)) { const added = emptyLine(warehouses[0]?.id ?? ''); onChange([...lines, added]); setFocusKey(added.key) }
  }

  return (
    <div ref={root} className="overflow-visible rounded-lg border border-line bg-surface" role="table" aria-label="Invoice lines">
      <div role="row" className="grid grid-cols-[2.2fr_0.7fr_0.9fr_0.7fr_0.5fr_1fr_1fr_32px] gap-1 border-b border-line bg-canvas px-2 py-1.5 text-xs font-semibold text-muted">
        <span>Item</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Disc. %</span><span className="text-center">Incl. GST</span><span className="text-right">Taxable</span><span className="text-right">Line total</span><span />
      </div>
      {lines.map((l, i) => {
        const c = computed?.[i]
        return (
          <div key={l.key} role="row" className="grid grid-cols-[2.2fr_0.7fr_0.9fr_0.7fr_0.5fr_1fr_1fr_32px] items-center gap-1 border-b border-line/60 px-2 py-1 last:border-0">
            <ItemCell line={l} autoFocus={focusKey === l.key} onPick={(item) => patch(l.key, { item, description: item.name, taxInclusive: l.taxInclusive })} onClear={() => patch(l.key, { item: null })} />
            <input data-nav aria-label="Quantity" inputMode="decimal" className={cn(cell, 'num text-right')} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} onKeyDown={(e) => enter(e, i)} disabled={readOnly} />
            <input data-nav aria-label="Price" inputMode="decimal" className={cn(cell, 'num text-right')} value={l.unitPrice} onChange={(e) => patch(l.key, { unitPrice: e.target.value })} onKeyDown={(e) => enter(e, i)} disabled={readOnly} />
            <input data-nav aria-label="Discount percent" inputMode="decimal" className={cn(cell, 'num text-right')} value={l.discountPercent} onChange={(e) => patch(l.key, { discountPercent: e.target.value })} onKeyDown={(e) => enter(e, i)} disabled={readOnly} />
            <div className="text-center"><input type="checkbox" aria-label="Price includes GST" checked={l.taxInclusive} onChange={(e) => patch(l.key, { taxInclusive: e.target.checked })} disabled={readOnly} /></div>
            <span className="num text-right text-sm text-muted">{c ? formatInr(c.taxableValue, { symbol: false }) : ''}</span>
            <span className="num text-right text-sm">{c ? formatInr(c.lineTotal, { symbol: false }) : ''}</span>
            <button type="button" aria-label="Remove line" className="grid size-7 place-items-center rounded text-muted hover:bg-canvas hover:text-bad" onClick={() => onChange(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [emptyLine(warehouses[0]?.id ?? '')])} disabled={readOnly}><Trash2 className="size-4" /></button>
          </div>
        )
      })}
    </div>
  )
}
