import { viewOf, type VariantView } from '@/domain/views'
import { listOf, type DataState } from './state'

/** Finds a variant by barcode or SKU (what a scanner or the search box hands us). Barcodes are exact; SKUs ignore case. */
export function findVariantByCode(state: DataState, raw: string): VariantView | null {
  const code = raw.trim()
  if (!code) return null
  const up = code.toUpperCase()
  const v = listOf(state.variants).find((x) => x.barcode === code || x.sku.toUpperCase() === up)
  return v ? viewOf(v, state.products[v.productId]) : null
}
