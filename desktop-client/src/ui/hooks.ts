import { useEffect, useState } from 'react'

/** A value that follows another after it has stopped changing for `ms` (used so typing in a search box does not call the server per key). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}
