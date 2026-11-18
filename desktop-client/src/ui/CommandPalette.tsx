import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MODULES, moduleOf, type NavItem } from './nav'

interface Command { id: string; label: string; hint: string; run: () => void; rank: number }
/** Things to do, beyond going to a page. Each needs the same permission as the page it opens. */
export const ACTIONS: { label: string; to: string; needs: string[]; keys?: string }[] = [
  { label: 'New invoice', to: '/sales/invoices/new', needs: ['sales:read'] },
  { label: 'New quote', to: '/sales/quotes/new', needs: ['sales:read'] },
  { label: 'New sales order', to: '/sales/orders/new', needs: ['sales:read'] },
  { label: 'New supplier bill', to: '/purchasing/bills/new', needs: ['purchasing:read'] },
  { label: 'New purchase order', to: '/purchasing/orders/new', needs: ['purchasing:read'] },
  { label: 'New journal entry', to: '/accounting/journals/new', needs: ['accounting:read'] },
  { label: 'Open the counter', to: '/pos/counter', needs: ['pos:sell'], keys: 'Ctrl B' },
]

const score = (label: string, q: string): number => {
  const l = label.toLowerCase()
  if (l === q) return 0
  if (l.startsWith(q)) return 1
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 2
  return l.includes(q) ? 3 : -1
}

/** Ctrl+K: type to jump to any page or start something new. Enter runs the top match; the arrows choose another. */
export function CommandPalette({ items, can, open, onClose }: { items: NavItem[]; can: (needs: string[]) => boolean; open: boolean; onClose: () => void }) {
  const go = useNavigate()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) input.current?.focus(); else { setQ(''); setAt(0) } }, [open])
  const all = useMemo<Command[]>(() => [
    ...ACTIONS.filter((a) => can(a.needs)).map((a) => ({ id: `a:${a.to}`, label: a.label, hint: a.keys ?? 'Action', rank: 0, run: () => void go({ to: a.to as never }) })),
    ...items.map((n) => ({ id: `n:${n.to}`, label: n.label, hint: MODULES.find((m) => m === moduleOf(n))?.label ?? '', rank: 1, run: () => void go({ to: n.to as never }) })),
  ], [items, can, go])
  const query = q.trim().toLowerCase()
  const shown = useMemo(() => (query ? all.map((c) => ({ c, s: score(c.label, query) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.c.rank - b.c.rank).map((x) => x.c) : all.filter((c) => c.rank === 0)).slice(0, 9), [all, query])
  if (!open) return null
  const run = (c: Command | undefined): void => { if (!c) return; onClose(); c.run() }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/25 pt-[14vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label="Command palette" className="w-[640px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-muted" aria-hidden />
          <input ref={input} aria-label="Search or run a command" role="combobox" aria-expanded="true" aria-controls="palette-list" value={q} placeholder="Go to a page or start something new…" className="h-12 flex-1 bg-transparent text-[15px] outline-none"
            onChange={(e) => { setQ(e.target.value); setAt(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(a + 1, shown.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(shown[at]) }
            }} />
          <kbd className="rounded border border-line px-1.5 text-[11px] text-muted">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[360px] overflow-auto py-1">
          {shown.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted">Nothing matches &ldquo;{q}&rdquo;.</li> : shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === at}>
              <button type="button" tabIndex={-1} onMouseEnter={() => setAt(i)} onClick={() => run(c)} className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${i === at ? 'bg-brand-soft text-ink' : ''}`}>
                <span>{c.label}</span><span className="text-xs text-muted">{c.hint}</span>
              </button>
            </li>))}
        </ul>
      </div>
    </div>
  )
}
