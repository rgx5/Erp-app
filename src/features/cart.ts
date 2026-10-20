import { useMemo } from 'react'
import { create } from 'zustand'
import { priceCart, type CartLine, type CartTotals } from '@/domain/cart'
import type { DiscountType, StoreSettings } from '@/domain/types'
import { costFor, needsPricing } from '@/domain/pricing'
import { fmtQtyUnit, isFrac, minQtyOf, qtyStep, round3 } from '@/domain/qty'
import { variantLabel } from '@/domain/codes'
import type { VariantView } from '@/domain/views'
import { useStore } from '@/data/hooks'
import { useApp } from '@/data/store'
import { adjustLines } from '@/modules/registry'

/**
 * The bill being rung up. It lives only in memory — a bill you walk away from can be parked (held), which is saved on
 * the phone; a half-built cart is not worth recovering after the app is killed.
 */
export interface CartState {
  lines: CartLine[]
  customerId: string | null
  billDiscountType: DiscountType
  billDiscountValue: number
  coupon: string
  /** Default seller for the bill (a staff user id). */
  staffId: string
  /** The parked bill this cart was resumed from; deleted when the bill is paid. */
  heldId: string | null
  /** Module data for the bill (`bill.ext`), keyed by module id — written by checkout panels. */
  extras: Record<string, unknown>
  setExtra: (moduleId: string, value: unknown) => void
  set: (patch: Partial<Omit<CartState, 'lines'>>) => void
  setLines: (lines: CartLine[]) => void
  patchLine: (variantId: string, patch: Partial<CartLine>) => void
  remove: (variantId: string) => void
  clear: () => void
}

const blank = { lines: [] as CartLine[], customerId: null, billDiscountType: 'amt' as DiscountType, billDiscountValue: 0, coupon: '', heldId: null, extras: {} as Record<string, unknown> }

export const useCart = create<CartState>((set) => ({
  ...blank,
  staffId: '',
  setExtra: (moduleId, value) => set((s) => ({ extras: { ...s.extras, [moduleId]: value } })),
  set: (patch) => set(patch),
  setLines: (lines) => set({ lines }),
  patchLine: (variantId, patch) => set((s) => ({ lines: s.lines.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)) })),
  remove: (variantId) => set((s) => ({ lines: s.lines.filter((l) => l.variantId !== variantId) })),
  clear: () => set((s) => ({ ...blank, staffId: s.staffId })),
}))

export type AddResult = { ok: true; line: CartLine; unpriced: boolean } | { ok: false; message: string }

/** A cart line for a variant, using how the item is sold (unit, fractions, GST, stock rules). */
export function lineFor(v: VariantView, basis: StoreSettings['costBasis'], qty?: number): CartLine {
  return {
    variantId: v.id, productId: v.productId, sku: v.sku, barcode: v.barcode, name: v.productName, size: v.size, color: v.color, hsn: v.hsn,
    mrp: v.mrp, price: v.price, qty: qty ?? minQtyOf(v), stock: v.stock, discountType: 'amt', discountValue: 0,
    unit: v.unit, fractional: v.fractional, step: v.step, minQty: v.minQty, noStock: !v.trackStock, noDiscount: v.noDiscount, fixedRate: v.gstRate,
    cost: costFor(v, basis),
    ...(needsPricing(v) ? { unpricedSale: true } : {}),
  }
}

/**
 * Adds a variant to the cart (or one more of it). Refuses what cannot be sold — sold out, more than is in stock, or an item
 * with no price that this person is not allowed to price at the counter.
 */
export function addToCart(v: VariantView, opts: { qty?: number; basis: StoreSettings['costBasis']; canPrice: boolean }): AddResult {
  const label = `${v.productName}${variantLabel(v.size, v.color) ? ` (${variantLabel(v.size, v.color)})` : ''}`
  if (!v.active) return { ok: false, message: `${v.productName} is no longer sold` }
  if (v.trackStock && v.stock <= 0) return { ok: false, message: `${label} is out of stock` }
  const unpriced = needsPricing(v)
  if (unpriced && !opts.canPrice) return { ok: false, message: `${label} has no price yet — ask a manager to price it` }

  const { lines, setLines } = useCart.getState()
  const existing = lines.find((l) => l.variantId === v.id)
  const add = opts.qty ?? (existing ? qtyStep(v) : minQtyOf(v))
  if (existing) {
    const next = round3(existing.qty + add)
    if (v.trackStock && next > v.stock) return { ok: false, message: `Only ${fmtQtyUnit(v.stock, v)} left in stock` }
    const updated = { ...existing, qty: next, stock: v.stock }
    setLines(lines.map((l) => (l.variantId === v.id ? updated : l)))
    return { ok: true, line: updated, unpriced: false }
  }
  if (v.trackStock && add > v.stock) return { ok: false, message: `Only ${fmtQtyUnit(v.stock, v)} left in stock` }
  const line = lineFor(v, opts.basis, add)
  setLines([...lines, line])
  return { ok: true, line, unpriced }
}

export interface CartView extends CartTotals { lines: CartLine[] }

/** Prices the live cart with the business's tax rules. */
export function useCartTotals(): CartView {
  const store = useStore()
  const raw = useCart((s) => s.lines)
  const type = useCart((s) => s.billDiscountType)
  const value = useCart((s) => s.billDiscountValue)
  const customerId = useCart((s) => s.customerId)
  const extras = useCart((s) => s.extras)
  const state = useApp((s) => s.data)
  // Modules (price lists, quantity breaks, promotions) may reprice the lines; the count and order never change.
  const lines = useMemo(() => adjustLines(raw, { state, customerId, extras }), [raw, state, customerId, extras])
  return useMemo(() => ({ ...priceCart(lines, type, value, store.slabs, store.priceIncludesTax), lines }), [lines, type, value, store.slabs, store.priceIncludesTax])
}

export const cartCount = (lines: CartLine[]) => lines.length
export const isFractional = (l: CartLine) => isFrac(l)
