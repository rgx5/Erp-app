import { useMemo } from 'react'
import { loadVariantViews, type VariantView } from '@/domain/views'
import type { AnalyticsInput } from '@/domain/analytics'
import type { StoreSettings } from '@/domain/types'
import { industryById, type IndustryPack } from '@/industries'
import { listOf, type Coll, type CollMap } from './state'
import { useApp } from './store'

/** A collection as an array, rebuilt only when that collection actually changes. */
export function useList<K extends Coll>(coll: K): CollMap[K][] {
  const rec = useApp((s) => s.data[coll])
  return useMemo(() => listOf(rec as Record<string, CollMap[K]>), [rec])
}

/** The business's settings. Screens only render once a business exists, so this is never null there. */
export function useStore(): StoreSettings {
  return useApp((s) => s.data.store) as StoreSettings
}

export function useIndustry(): IndustryPack {
  const id = useApp((s) => s.workspace?.industry)
  return useMemo(() => industryById(id), [id])
}

/** What this industry calls things ("Patient", "Order", "Menu"…). */
export function useLabels() {
  return useIndustry().labels
}

export function useVariantViews(): VariantView[] {
  const products = useList('products')
  const variants = useList('variants')
  return useMemo(() => loadVariantViews(products, variants), [products, variants])
}

export function useAnalyticsInput(): AnalyticsInput {
  const bills = useList('bills')
  const expenses = useList('expenses')
  const variants = useList('variants')
  const products = useList('products')
  const store = useApp((s) => s.data.store)
  return useMemo(() => ({ bills, expenses, variants, products, store }), [bills, expenses, variants, products, store])
}

/** Whether this phone talks to a server (as opposed to holding the business on its own). */
export const useConnected = () => useApp((s) => s.workspace?.mode === 'remote')
