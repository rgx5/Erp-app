import { ean13CheckDigit, isValidEan13 } from './barcode'

/**
 * Labels printed by a weighing scale (or a deli counter) carry the weight or the price inside the barcode:
 *
 *   2 X IIIII VVVVV C      prefix · (filler) · item code · weight or price · check digit
 *
 * The layout is configurable because scales differ; this is the common 13-digit one.
 */
export type ScaleValueKind = 'weight_g' | 'weight_10g' | 'price_rupees' | 'price_paise'

export interface ScaleLayout {
  enabled: boolean
  /** The label starts with this (scales use 20–29: '2'). */
  prefix: string
  itemDigits: number
  valueDigits: number
  value: ScaleValueKind
}

/** Off until the shop turns it on: the app's own item barcodes also start with 2, and an exact barcode match always wins first. */
export const DEFAULT_SCALE: ScaleLayout = { enabled: false, prefix: '2', itemDigits: 5, valueDigits: 5, value: 'weight_g' }

/** Digits between the prefix and the item code that the scale uses for its own flags. */
export const scaleFiller = (l: ScaleLayout) => 12 - l.prefix.length - l.itemDigits - l.valueDigits

/** Why a layout cannot describe a 13-digit label, or null. */
export function scaleLayoutProblem(l: ScaleLayout): string | null {
  if (!/^\d{1,2}$/.test(l.prefix)) return 'The prefix is one or two digits, usually 2.'
  if (l.itemDigits < 2 || l.itemDigits > 8) return 'The item code is between 2 and 8 digits.'
  if (l.valueDigits < 3 || l.valueDigits > 6) return 'The weight or price is between 3 and 6 digits.'
  if (scaleFiller(l) < 0) return 'Prefix, item code and weight/price together are more than the 12 digits a label has before its check digit.'
  return null
}

export interface ScaleRead {
  /** The item code printed on the label (digits, as written). */
  item: string
  /** Grams, or rupees — see `kind`. */
  value: number
  kind: 'weight' | 'price'
}

/** Reads a scale label, or null when `code` is not one (wrong length, prefix or check digit, or a layout that does not fit). */
export function parseScaleBarcode(code: string, layout: ScaleLayout): ScaleRead | null {
  const c = code.trim()
  if (!layout.enabled || scaleLayoutProblem(layout) || !/^\d{13}$/.test(c) || !c.startsWith(layout.prefix) || !isValidEan13(c)) return null
  const at = layout.prefix.length + scaleFiller(layout)
  const item = c.slice(at, at + layout.itemDigits)
  const raw = Number(c.slice(at + layout.itemDigits, at + layout.itemDigits + layout.valueDigits))
  switch (layout.value) {
    case 'weight_g': return { item, value: raw, kind: 'weight' }
    case 'weight_10g': return { item, value: raw * 10, kind: 'weight' }
    case 'price_rupees': return { item, value: raw, kind: 'price' }
    case 'price_paise': return { item, value: Math.round(raw) / 100, kind: 'price' }
  }
}

const stripZeros = (s: string) => s.replace(/^0+/, '')

/** Does a variant's barcode or SKU say it is the item a label names? Leading zeros do not matter (the PLU 00123 is 123). */
export const matchesItemCode = (v: { barcode: string; sku: string }, item: string) => {
  const want = stripZeros(item)
  return !!want && (stripZeros(v.barcode) === want || v.sku.toUpperCase() === item.toUpperCase() || stripZeros(v.sku) === want)
}

/** How much to sell for a label: kilograms (or grams, for items sold by the gram) from a weight, or the price divided by the unit price. */
export function scaleQuantity(read: ScaleRead, unit: string, unitPrice: number): number | null {
  if (read.kind === 'weight') {
    if (unit === 'g') return read.value
    return Math.round(read.value) / 1000 // kilograms: the usual unit of a scale
  }
  if (!(unitPrice > 0)) return null
  return Math.round((read.value / unitPrice) * 1000) / 1000
}

/**
 * The inverse of `parseScaleBarcode`: the 13-digit label for an item and a weight (grams) or price (rupees), in the shop's layout —
 * for printing in-house price-embedded labels, or checking what a scale should print. Null when the layout or the numbers do not fit.
 */
export function makeScaleBarcode(layout: ScaleLayout, item: string, value: number): string | null {
  if (scaleLayoutProblem(layout) || !/^\d+$/.test(item) || item.length > layout.itemDigits || !(value >= 0)) return null
  const raw = layout.value === 'weight_g' ? Math.round(value) : layout.value === 'weight_10g' ? Math.round(value / 10) : layout.value === 'price_rupees' ? Math.round(value) : Math.round(value * 100)
  if (raw >= 10 ** layout.valueDigits) return null
  const body = layout.prefix + '0'.repeat(scaleFiller(layout)) + item.padStart(layout.itemDigits, '0') + String(raw).padStart(layout.valueDigits, '0')
  return body + ean13CheckDigit(body)
}
