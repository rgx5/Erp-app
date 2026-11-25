import { useEffect, useState } from 'react'

/** A value that follows another after it has stopped changing for `ms` (used so typing in a search box does not call the server per key). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/**
 * Arrow-key control for a list of search results under a text box: Down and Up move the highlight, Enter picks it, and the highlighted row stays in
 * view. The highlight starts on the first row each time the list changes. `moved` says whether the person has used the arrows yet (so a screen
 * where Enter already means something else, like a barcode scan, can keep that meaning until they do).
 */
export function useListNav<T>(rows: readonly T[], onPick: (row: T) => void, open = true) {
  const [active, setActive] = useState(0)
  const [moved, setMoved] = useState(false)
  useEffect(() => { setActive(0); setMoved(false) }, [rows.length, open])
  const onKeyDown = (e: { key: string; preventDefault(): void }): boolean => {
    if (!open || rows.length === 0) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % rows.length); setMoved(true); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + rows.length) % rows.length); setMoved(true); return true }
    if (e.key === 'Enter' && rows[active] !== undefined) { e.preventDefault(); onPick(rows[active] as T); return true }
    return false
  }
  /** Put on each option: keeps the highlighted one scrolled into view. */
  const keep = (n: number) => (el: HTMLElement | null) => { if (el && n === active) el.scrollIntoView?.({ block: 'nearest' }) }
  return { active, setActive, moved, onKeyDown, keep }
}
