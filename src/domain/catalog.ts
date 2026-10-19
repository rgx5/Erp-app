import type { Category, CategoryConfig, Product, Variant } from './types'
import { needsPricing } from './pricing'
import { round2 } from './money'
import { round3 } from './qty'
import { stockLevel } from './stock'
import type { VariantView } from './views'

/** One product with its variants rolled up — what a catalogue list row shows. */
export interface ProductRow {
  product: Product
  variants: VariantView[]
  stock: number
  low: number
  out: number
  unpriced: number
  minPrice: number
  maxPrice: number
  /** Stock value at cost. */
  value: number
}

export function rollUp(products: Product[], variants: VariantView[]): ProductRow[] {
  const by = new Map<string, VariantView[]>()
  for (const v of variants) { const l = by.get(v.productId); if (l) l.push(v); else by.set(v.productId, [v]) }
  return products.map((product) => {
    const vs = by.get(product.id) ?? []
    let stock = 0, low = 0, out = 0, unpriced = 0, value = 0
    const prices: number[] = []
    for (const v of vs) {
      if (v.trackStock) { stock = round3(stock + v.stock); value += Math.max(0, v.stock) * (v.avgCost ?? v.cost); const lv = stockLevel(v); if (lv === 'low') low++; if (lv === 'out') out++ }
      if (needsPricing(v)) unpriced++; else prices.push(v.price)
    }
    return { product, variants: vs, stock, low, out, unpriced, minPrice: prices.length ? Math.min(...prices) : 0, maxPrice: prices.length ? Math.max(...prices) : 0, value: round2(value) }
  })
}

export type CatalogFilter = '' | 'low' | 'out' | 'pricing' | 'archived'

export function filterCatalog(rows: ProductRow[], needle: string, filter: CatalogFilter, categoryId: string): ProductRow[] {
  const n = needle.trim().toLowerCase()
  return rows
    .filter((r) => {
      if (filter === 'archived') { if (r.product.active !== false) return false } else if (r.product.active === false) return false
      if (categoryId && r.product.categoryId !== categoryId) return false
      if (filter === 'low' && !(r.low > 0)) return false
      if (filter === 'out' && !(r.out > 0)) return false
      if (filter === 'pricing' && !(r.unpriced > 0)) return false
      if (!n) return true
      return r.product.name.toLowerCase().includes(n) || r.product.styleCode.toLowerCase().includes(n) || r.product.brand.toLowerCase().includes(n)
        || r.variants.some((v) => v.sku.toLowerCase().includes(n) || v.barcode.includes(n))
    })
    .sort((a, b) => a.product.name.localeCompare(b.product.name))
}

/** The selling-rule fields of a new item that its category decides (unit, fractions, GST, reorder level…). */
export function rulesFromConfig(cfg: CategoryConfig | undefined, defaults: { hsn: string; reorder: number }) {
  const c = cfg ?? {}
  return {
    hsn: c.hsn ?? defaults.hsn,
    unit: c.unit || 'pc',
    fractional: c.fractional,
    step: c.step,
    minQty: c.minQty,
    trackStock: c.trackStock !== false,
    noDiscount: !!c.noDiscount,
    gstRate: c.gstRate,
    reorderLevel: c.reorderLevel ?? defaults.reorder,
  }
}

export const categoryName = (cats: Record<string, Category>, id: string) => cats[id]?.name ?? 'Uncategorised'

/** Variants grouped by their second option (colour), for a tidy matrix. */
export function groupByOption2(vs: Array<Pick<Variant, 'color'>>): string[] {
  return [...new Set(vs.map((v) => v.color))]
}
