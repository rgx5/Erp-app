import { X } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePane } from './paneContext'

const InsideDrawer = createContext(false)

/**
 * One record, for creating or editing. Inside the app shell it docks to the right of the page so the list stays in view; elsewhere it
 * slides over the page. Escape closes it; focus moves in and returns.
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
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-muted hover:bg-canvas hover:text-ink"><X className="size-4" /></button>
      </header>
      <div className="flex-1 overflow-auto p-4"><InsideDrawer.Provider value>{children}</InsideDrawer.Provider></div>
    </div>
  )
  if (pane) return createPortal(body, pane)
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="h-full border-l border-line shadow-pop">{body}</div>
    </div>
  )
}
