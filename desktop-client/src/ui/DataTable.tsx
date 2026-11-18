import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'
import { cn } from './cn'

/**
 * The grid every list screen uses: sortable columns and a virtualised body, so 100,000 rows scroll as smoothly as 20. Row
 * height is fixed, which is what makes virtualisation cheap and keyboard navigation predictable.
 */
export function DataTable<T>({ columns, rows, rowKey, onOpen, empty = 'Nothing here yet.', height = 520 }: {
  columns: ColumnDef<T, unknown>[]
  rows: T[]
  rowKey: (row: T) => string
  onOpen?: (row: T) => void
  empty?: string
  height?: number
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  // TanStack builds its rows from `data` alone and remembers each cell's value, so a change of columns (for example names that arrive
  // after the rows) must also be a new `data` array. Callers should keep `columns` stable (useMemo) for big lists.
  const data = useMemo(() => [...rows], [rows, columns])
  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: rowKey })
  const body = useRef<HTMLDivElement>(null)
  const list = table.getRowModel().rows
  const virtual = useVirtualizer({ count: list.length, getScrollElement: () => body.current, estimateSize: () => 38, overscan: 12 })
  const template = `grid-template-columns: ${table.getAllLeafColumns().map((c) => `minmax(${c.getSize() ? Math.min(c.getSize(), 140) : 100}px, ${Math.max(c.getSize(), 100)}fr)`).join(' ')}`

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card" role="table" aria-rowcount={list.length}>
      <div role="rowgroup" className="border-b border-line bg-[#f8f9fc]">
        {table.getHeaderGroups().map((group) => (
          <div key={group.id} role="row" className="grid gap-x-3 px-4" style={cssGrid(template)}>
            {group.headers.map((h) => (
              <button key={h.id} role="columnheader" type="button" onClick={h.column.getToggleSortingHandler()} className={cn('flex h-9 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted', (h.column.columnDef.meta as { align?: string } | undefined)?.align === 'right' && 'justify-end')}>
                {flexRender(h.column.columnDef.header, h.getContext())}
                {({ asc: ' ▲', desc: ' ▼' } as Record<string, string>)[h.column.getIsSorted() as string] ?? ''}
              </button>
            ))}
          </div>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">{empty}</p>
      ) : (
        <div ref={body} role="rowgroup" style={{ height: Math.min(height, virtual.getTotalSize() || height), overflow: 'auto' }}>
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((v) => {
              const row = list[v.index]
              if (!row) return null
              return (
                <div
                  key={row.id}
                  role="row"
                  tabIndex={onOpen ? 0 : -1}
                  onClick={() => onOpen?.(row.original)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(row.original) }}
                  className="absolute left-0 grid w-full items-center gap-x-3 border-b border-line/60 px-4 text-sm hover:bg-brand-soft/60 focus-visible:bg-brand-soft focus-visible:outline-none"
                  style={{ ...cssGrid(template), height: v.size, transform: `translateY(${v.start}px)` }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div key={cell.id} role="cell" className={cn('truncate', (cell.column.columnDef.meta as { align?: string } | undefined)?.align === 'right' && 'num text-right')}>
                      {cell.column.columnDef.header === 'Status' ? <StatusPill value={cell.getValue()} /> : flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const GOOD = /^(posted|open|active|paid|completed|done|released|invoiced|in stock|working|reconciled|applied|approved)/i
const BAD = /^(cancel|reject|refused|blocked|revoked|disabled|expired|overdue|exited|failed)/i
const WARN = /^(partly|partially|in progress|in transit|pending|planned|draft|held|holding|not paid|posted, not paid)/i
/** A status word as a small coloured pill, so a list can be scanned by colour. */
function StatusPill({ value }: { value: unknown }) {
  const text = String(value ?? '')
  if (!text) return null
  const tone = WARN.test(text) ? 'bg-[#fff6e5] text-warn' : BAD.test(text) ? 'bg-[#fdf2f1] text-bad' : GOOD.test(text) ? 'bg-[#e8f6f0] text-good' : 'bg-canvas text-muted'
  return <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', tone)}>{text}</span>
}

const cssGrid = (template: string): React.CSSProperties => ({ gridTemplateColumns: template.replace('grid-template-columns: ', '') })
