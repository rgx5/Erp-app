import { create } from 'zustand'
import { round3 } from '@/domain/qty'

/**
 * A physical stock count in progress. It lives in memory so leaving the screen (to scan, to look something up) never
 * loses it; only posting or discarding clears it.
 */
interface CountStore {
  counted: Record<string, number>
  /** Variant ids in the order they were first counted. */
  order: string[]
  bump: (variantId: string, by?: number) => number
  set: (variantId: string, qty: number) => void
  remove: (variantId: string) => void
  clear: () => void
}

export const useCount = create<CountStore>((set, get) => ({
  counted: {},
  order: [],
  bump: (variantId, by = 1) => {
    const s = get()
    const next = round3((s.counted[variantId] ?? 0) + by)
    set({ counted: { ...s.counted, [variantId]: next }, order: s.order.includes(variantId) ? s.order : [...s.order, variantId] })
    return next
  },
  set: (variantId, qty) => {
    const s = get()
    set({ counted: { ...s.counted, [variantId]: Math.max(0, round3(qty)) }, order: s.order.includes(variantId) ? s.order : [...s.order, variantId] })
  },
  remove: (variantId) => {
    const { [variantId]: _drop, ...rest } = get().counted
    set({ counted: rest, order: get().order.filter((x) => x !== variantId) })
  },
  clear: () => set({ counted: {}, order: [] }),
}))
