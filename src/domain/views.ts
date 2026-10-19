import type { Product, Variant } from './types'

/** A variant joined to its product — the shape every screen actually needs. */
export interface VariantView extends Variant {
  productName: string
  styleCode: string
  brand: string
  hsn: string
  categoryId: string
  unit: string
  fractional?: boolean
  step?: number
  minQty?: number
  trackStock: boolean
  noDiscount: boolean
  gstRate?: number
  active: boolean
}

export function viewOf(v: Variant, p: Product | undefined): VariantView {
  return {
    ...v,
    productName: p?.name ?? 'Unknown item',
    styleCode: p?.styleCode ?? '',
    brand: p?.brand ?? '',
    hsn: p?.hsn ?? '',
    categoryId: p?.categoryId ?? '',
    unit: p?.unit ?? 'pc',
    fractional: p?.fractional,
    step: p?.step,
    minQty: p?.minQty,
    trackStock: p?.trackStock !== false,
    noDiscount: !!p?.noDiscount,
    gstRate: p?.gstRate,
    active: p?.active !== false,
  }
}

export function loadVariantViews(products: Product[], variants: Variant[]): VariantView[] {
  const pmap = new Map(products.map((p) => [p.id, p]))
  return variants.map((v) => viewOf(v, pmap.get(v.productId)))
}
