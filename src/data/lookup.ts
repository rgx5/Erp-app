import { matchesItemCode, parseScaleBarcode, scaleQuantity, DEFAULT_SCALE, type ScaleLayout } from '@/domain/scale'
import { viewOf, type VariantView } from '@/domain/views'
import { listOf, type DataState } from './state'

/** A found variant, plus how much to sell when the code was a weighing-scale label (`2 X IIIII VVVVV C`). */
export type ScannedVariant = VariantView & { scanQty?: number }

/** The shop's scale-label layout (set in the pricing module's settings; off by default). */
export function scaleLayoutOf(state: DataState): ScaleLayout {
  const s = (state as unknown as { pricingSettings?: Record<string, { scale?: Partial<ScaleLayout> } | undefined> }).pricingSettings?.settings?.scale
  return { ...DEFAULT_SCALE, ...(s ?? {}) }
}

/**
 * Finds a variant by barcode or SKU (what a scanner or the search box hands us). Barcodes are exact; SKUs ignore case.
 * When nothing matches exactly and the shop has turned scale labels on, a 13-digit label is read for its item code and its
 * weight or price: the variant comes back with `scanQty`, the amount to sell.
 */
export function findVariantByCode(state: DataState, raw: string): ScannedVariant | null {
  const code = raw.trim()
  if (!code) return null
  const up = code.toUpperCase()
  const variants = listOf(state.variants)
  const v = variants.find((x) => x.barcode === code || x.sku.toUpperCase() === up)
  if (v) return viewOf(v, state.products[v.productId])

  const read = parseScaleBarcode(code, scaleLayoutOf(state))
  if (!read) return null
  const hit = variants.find((x) => matchesItemCode(x, read.item))
  if (!hit) return null
  const view = viewOf(hit, state.products[hit.productId])
  const qty = scaleQuantity(read, view.unit, view.price)
  return qty && qty > 0 ? { ...view, scanQty: qty } : view
}
