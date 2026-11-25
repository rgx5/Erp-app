import { X } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePane } from './paneContext'

const InsideDrawer = createContext(false)

const ARROW_SKIP = new Set(['number', 'date', 'datetime-local', 'time', 'month', 'week', 'radio', 'range', 'file'])
const FIELD = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button[type=submit]:not([disabled])'
/**
 * Up and Down move between the fields of a form, like Tab and Shift+Tab. A field that uses those keys itself keeps them: a list that is open (a
 * customer or item picker), a select, a multi-line box, a number or date. Whatever a field already handled (it called preventDefault) is left alone.
 */
export function arrowNavigate(e: ReactKeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (e.defaultPrevented || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !root) return
  const t = e.target as HTMLElement
  if (t.tagName !== 'INPUT') return
  if (ARROW_SKIP.has((t as HTMLInputElement).type)) return
  if (t.getAttribute('role') === 'combobox' || t.getAttribute('aria-autocomplete') || t.getAttribute('aria-expanded') === 'true' || t.getAttribute('aria-haspopup')) return
  const fields = Array.from(root.querySelectorAll<HTMLElement>(FIELD)).filter((el) => el.offsetParent !== null && el.tabIndex !== -1)
  const at = fields.indexOf(t)
  const next = fields[at + (e.key === 'ArrowDown' ? 1 : -1)]
  if (at < 0 || !next) return
  e.preventDefault()
  next.focus()
  if (next instanceof HTMLInputElement && !ARROW_SKIP.has(next.type) && next.type !== 'checkbox') next.select()
}

/**
 * One record, for creating or editing. Inside the app shell it docks to the right of the page so the list stays in view; elsewhere it
 * slides over the page. The close button or Escape closes it (a click outside does not, so nothing typed is lost); Up and Down move between fields; focus moves in and returns.
 */
export function Drawer({ title, onClose, children, width = 520 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const panel = useRef<HTMLDivElement>(null)
  const shell = usePane()
  // A record docks beside the page; one opened from inside another (a payslip from a run) slides over it instead of stacking.
  const nested = useContext(InsideDrawer)
  const pane = nested ? null : shell
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [onClose])
  const body = (
    <div ref={panel} role="dialog" aria-modal={pane ? undefined : true} aria-label={title} className="flex h-full flex-col bg-surface" style={{ width: Math.min(width, 640) }}>
      <header className="drawer-head flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4">
        <h2 className="min-w-0 truncate text-base font-semibold">{title}</h2>
        <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line text-ink hover:bg-canvas"><X className="size-4" aria-hidden /></button>
      </header>
      <div className="flex-1 overflow-auto p-5" onKeyDown={(e) => arrowNavigate(e, panel.current)}><InsideDrawer.Provider value>{children}</InsideDrawer.Provider></div>
    </div>
  )
  if (pane) return createPortal(body, pane)
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30">
      <div className="h-full border-l border-line shadow-pop">{body}</div>
    </div>
  )
}
