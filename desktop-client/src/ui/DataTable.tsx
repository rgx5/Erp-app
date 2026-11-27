import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from './cn'
import { Tag } from './primitives'
import { usePhone } from './usePhone'

/**
 * The grid every list screen uses: sortable columns and a virtualised body, so 100,000 rows scroll as smoothly as 20. Row
 * height is fixed, which is what makes virtualisation cheap and keyboard navigation predictable.
 */
export function DataTable<T>({ columns, rows, rowKey, onOpen, empty = 'Nothing here yet.', height: _height }: {
  columns: ColumnDef<T, unknown>[]
  rows: T[]
  rowKey: (row: T) => string
  onOpen?: (row: T) => void
  empty?: string
  /** Kept for older callers: the grid now fills the space left on the screen. */
  height?: number
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [active, setActive] = useState(-1)
  const phone = usePhone()
  const [shown, setShown] = useState(60)
  // TanStack builds its rows from `data` alone and remembers each cell's value, so a change of columns (for example names that arrive
  // after the rows) must also be a new `data` array. Callers should keep `columns` stable (useMemo) for big lists.
  const data = useMemo(() => [...rows], [rows, columns])
  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: rowKey })
  const body = useRef<HTMLDivElement>(null)
  const list = table.getRowModel().rows
  const virtual = useVirtualizer({ count: list.length, getScrollElement: () => body.current, estimateSize: () => 34, overscan: 12 })
  // a column may ask for more room than the usual minimum (a column of buttons) with `meta: { minWidth }`
  const floor = (c: { getSize(): number; columnDef: { meta?: unknown } }): number => (c.columnDef.meta as { minWidth?: number } | undefined)?.minWidth ?? (c.getSize() ? Math.min(c.getSize(), 140) : 100)
  const template = `grid-template-columns: ${table.getAllLeafColumns().map((c) => `minmax(${floor(c)}px, ${Math.max(c.getSize(), 100)}fr)`).join(' ')}`

  if (phone) {
    // On a phone each row is a card: the first column is its title, the other columns are label and value, and a column with no heading (the buttons) goes last.
    const cols = (r: (typeof list)[number]) => r.getVisibleCells()
    const headerOf = (c: ReturnType<typeof cols>[number]): string => (typeof c.column.columnDef.header === 'string' ? c.column.columnDef.header : '')
    if (list.length === 0) return <p className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-muted">{empty}</p>
    return (
      <div role="table" aria-rowcount={list.length} className="flex flex-col gap-2">
        {list.slice(0, shown).map((row) => {
          const cells = cols(row); const [first, ...rest] = cells
          const status = rest.find((c) => ['Status', 'State'].includes(headerOf(c)))
          const fields = rest.filter((c) => c !== status && headerOf(c) !== '')
          const actions = rest.filter((c) => headerOf(c) === '')
          return (
            <div key={row.id} role="row" onClick={() => onOpen?.(row.original)} className={cn('rounded-lg border border-line bg-surface px-3.5 py-3', onOpen && 'cursor-pointer active:bg-sunken')}>
              <div className="flex items-start justify-between gap-3">
                <div role="cell" className="min-w-0 flex-1 text-[14.5px] font-semibold leading-snug break-words">{first ? flexRender(first.column.columnDef.cell, first.getContext()) : null}</div>
                {status ? <div role="cell" className="shrink-0">{status.column.columnDef.header === 'Status' ? <StatusPill value={status.getValue()} /> : flexRender(status.column.columnDef.cell, status.getContext())}</div> : null}
              </div>
              {fields.length ? (
                <dl className="keep-cols mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[13px]">
                  {fields.map((c) => { const v = flexRender(c.column.columnDef.cell, c.getContext()); return (<div key={c.id} role="cell" className="contents"><dt className="text-muted">{headerOf(c)}</dt><dd className="min-w-0 break-words text-right">{v}</dd></div>) })}
                </dl>
              ) : null}
              {actions.length ? <div className="mt-2.5 flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>{actions.map((c) => <div key={c.id} role="cell" className="contents">{flexRender(c.column.columnDef.cell, c.getContext())}</div>)}</div> : null}
            </div>
          )
        })}
        {list.length > shown ? <button type="button" onClick={() => setShown((n) => n + 60)} className="h-11 rounded-lg border border-line bg-surface text-[14px] font-medium text-brand">Show more ({(list.length - shown).toLocaleString('en-IN')} left)</button> : null}
        <p className="py-1 text-center text-[11.5px] text-muted">{list.length.toLocaleString('en-IN')} {list.length === 1 ? 'row' : 'rows'}</p>
      </div>
    )
  }

  // every column keeps at least its minimum width; a screen narrower than that scrolls sideways instead of hiding columns
  const minWidth = table.getAllLeafColumns().reduce((sum, c) => sum + floor(c) + 12, 24)
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
    <div role="table" aria-rowcount={list.length} style={{ minWidth }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const next = Math.max(0, Math.min(list.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)))
        setActive(next); virtual.scrollToIndex(next)
        requestAnimationFrame(() => body.current?.querySelector<HTMLElement>(`[data-row="${next}"]`)?.focus())
      }}>
      <div role="rowgroup" className="border-b border-line bg-sunken">
        {table.getHeaderGroups().map((group) => (
          <div key={group.id} role="row" className="grid gap-x-3 px-3" style={cssGrid(template)}>
            {group.headers.map((h) => (
              <div key={h.id} role="columnheader" aria-sort={h.column.getIsSorted() === "asc" ? "ascending" : h.column.getIsSorted() === "desc" ? "descending" : "none"} className="min-w-0"><button type="button" onClick={h.column.getToggleSortingHandler()} className={cn('group flex h-8 items-center gap-1 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted hover:text-ink', (h.column.columnDef.meta as { align?: string } | undefined)?.align === 'right' && 'justify-end')}>
                {flexRender(h.column.columnDef.header, h.getContext())}
                {h.column.getIsSorted() === 'asc' ? <ArrowUp className="size-3 text-brand" aria-hidden /> : h.column.getIsSorted() === 'desc' ? <ArrowDown className="size-3 text-brand" aria-hidden /> : <ChevronsUpDown className="size-3 opacity-0 group-hover:opacity-60" aria-hidden />}
              </button></div>
            ))}
          </div>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">{empty}</p>
      ) : (
        <div ref={body} role="rowgroup" style={{ height: `min(${virtual.getTotalSize()}px, calc(100vh - 270px))`, minHeight: Math.min(virtual.getTotalSize(), 220), overflow: 'auto' }}>
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((v) => {
              const row = list[v.index]
              if (!row) return null
              return (
                <div
                  key={row.id}
                  role="row"
                  data-row={v.index}
                  tabIndex={onOpen ? (v.index === Math.max(active, 0) ? 0 : -1) : -1}
                  onFocus={() => setActive(v.index)}
                  onClick={() => onOpen?.(row.original)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(row.original) }}
                  className={cn('absolute left-0 grid w-full items-center gap-x-3 border-b border-line/70 px-3 text-[13px] transition-colors hover:bg-sunken focus-visible:bg-brand-soft focus-visible:shadow-[inset_2px_0_0_var(--color-brand)] focus-visible:outline-none', onOpen && 'cursor-pointer', active === v.index && 'bg-brand-soft/50')}
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
      {list.length > 0 ? <div className="flex h-7 items-center justify-between border-t border-line bg-sunken px-3 text-[11.5px] text-muted"><span>{list.length.toLocaleString('en-IN')} {list.length === 1 ? 'row' : 'rows'}</span>{onOpen ? <span><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open</span> : null}</div> : null}
    </div>
    </div>
  )
}

const GOOD = /^(posted|open|active|paid|completed|done|released|invoiced|in stock|working|reconciled|applied|approved)/i
const BAD = /^(cancel|reject|refused|blocked|revoked|disabled|expired|overdue|exited|failed)/i
const WARN = /^(partly|partially|in progress|in transit|pending|planned|draft|held|holding|not paid|posted, not paid)/i
/** A status word as a dot and the word, so a list can be scanned by colour without blocks of it. */
function StatusPill({ value }: { value: unknown }) {
  const text = String(value ?? '')
  if (!text) return null
  const tone = WARN.test(text) ? 'warn' : BAD.test(text) ? 'bad' : GOOD.test(text) ? 'good' : 'neutral'
  return <Tag tone={tone}>{text}</Tag>
}

const cssGrid = (template: string): React.CSSProperties => ({ gridTemplateColumns: template.replace('grid-template-columns: ', '') })
