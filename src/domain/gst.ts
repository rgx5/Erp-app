import type { StoreSettings } from './types'

/** GST state codes (the first two digits of a GSTIN; also the "place of supply"). */
export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '96': 'Other Country',
}
export const stateName = (code: string | undefined) => (code ? STATE_CODES[code] ?? '' : '')
export const STATE_OPTIONS = Object.entries(STATE_CODES).filter(([c]) => c !== '96').map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** The check character of a GSTIN's first 14 characters (the GSTN's modulus-36 scheme). */
export function gstinCheckChar(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(v / 36) + (v % 36)
  }
  return CHARS[(36 - (sum % 36)) % 36]
}

/** What is wrong with a GSTIN, in words, or null when it is a well-formed GSTIN with a valid check character. Empty is "no GSTIN", not an error. */
export function gstinProblem(raw: string | undefined | null): string | null {
  const g = (raw ?? '').trim().toUpperCase()
  if (!g) return null
  if (g.length !== 15) return 'A GSTIN has 15 characters.'
  if (!FORMAT.test(g)) return 'That does not look like a GSTIN (2 digits, 5 letters, 4 digits, a letter, then 1, Z and a check character).'
  if (!STATE_CODES[g.slice(0, 2)]) return `${g.slice(0, 2)} is not a GST state code.`
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return 'The last character does not match the rest — check the GSTIN for a typing mistake.'
  return null
}
export const isValidGstin = (g: string | undefined | null) => !!(g ?? '').trim() && gstinProblem(g) === null

/** The state code a GSTIN belongs to ('' when it has none). */
export const gstinState = (g: string | undefined | null) => {
  const c = (g ?? '').trim().slice(0, 2)
  return /^\d{2}$/.test(c) && STATE_CODES[c] ? c : ''
}

/** What the pricing module records on a bill (`bill.ext.pricing`). Everything is optional: a plain retail bill has none of it. */
export interface BillTaxInfo {
  /** 'bill_of_supply' for composition / unregistered dealers: no tax is shown or collected. */
  taxMode?: 'tax_invoice' | 'bill_of_supply'
  /** State code of the place of supply. */
  placeOfSupply?: string
  buyerGstin?: string
  buyerName?: string
  reverseCharge?: boolean
  /** The supply crosses state lines, so GST is IGST. */
  interState?: boolean
  /** A price list picked for this bill alone; empty / missing = the customer's own list (or the shop's default). */
  priceListId?: string
}
export const taxInfoOf = (bill: { ext?: Record<string, unknown> }): BillTaxInfo => ((bill.ext?.pricing ?? {}) as BillTaxInfo & Record<string, unknown>)

/** The GST treatment of a sale: tax-free (bill of supply) or taxed, and whether it is IGST. */
export interface SupplyOptions { interState: boolean; noTax: boolean }

export const isBillOfSupplyStore = (store: Pick<StoreSettings, 'registrationType'> | null | undefined) =>
  store?.registrationType === 'composition' || store?.registrationType === 'unregistered'

/**
 * Decides how a sale is taxed. A composition or unregistered dealer charges no GST. Otherwise it is IGST when the place of
 * supply is in another state than the seller's: the place of supply is the one picked at checkout, else the buyer's GSTIN
 * state; with neither, the sale is local (the retail default).
 */
export function supplyOptions(
  store: Pick<StoreSettings, 'gstin' | 'registrationType'> | null | undefined,
  customerGstin: string | undefined | null,
  info?: Pick<BillTaxInfo, 'placeOfSupply' | 'buyerGstin'>,
): SupplyOptions {
  if (isBillOfSupplyStore(store)) return { interState: false, noTax: true }
  const own = gstinState(store?.gstin)
  const pos = info?.placeOfSupply || gstinState(info?.buyerGstin) || gstinState(customerGstin)
  return { interState: !!own && !!pos && own !== pos, noTax: false }
}
