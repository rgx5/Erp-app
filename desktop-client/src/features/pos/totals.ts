import { fromUnits, toUnits } from '@/domain/money'

export interface CartLine { key: string; itemId: string; code: string; name: string; quantity: string; unitPrice: string; discountPercent: string; taxInclusive: boolean; taxCodeId: string | null; tracking: 'none' | 'batch' | 'serial'; batchId: string; serials: string; noDiscount?: boolean; salespersonId?: string }

export const serialList = (v: string): string[] => v.split(/[\n,;\s]+/).map((x) => x.trim()).filter(Boolean)
/** A tracked item is sellable once its batch is chosen, or exactly one distinct serial number per unit is entered. */
export const trackingReady = (l: CartLine): boolean => (l.tracking === 'batch' ? l.batchId !== '' : l.tracking === 'serial' ? serialList(l.serials).length === Number(l.quantity) && new Set(serialList(l.serials)).size === serialList(l.serials).length : true)

/** Rounds to paise: half up, like the server's line totals. */
const round2 = (v: bigint): bigint => { const sign = v < 0n ? -1n : 1n; const a = v < 0n ? -v : v; return sign * ((a + 50n) / 100n) * 100n }

/**
 * A counter total worked out here, for selling without a connection. It follows the server's rule for tax-inclusive prices
 * (each line is quantity x price less discount, to the paisa; the sale is rounded to the nearest rupee, half up) so the till and the
 * server agree. While online the server's own calculation is used instead; this is only the fallback.
 */
export function localTotal(lines: CartLine[]): { payable: string; roundOff: string; grandTotal: string } {
  let payable = 0n
  for (const l of lines) {
    const gross = (toUnits(l.unitPrice) * toQty(l.quantity)) / 1_000_000n // 4dp value
    const net = gross - (gross * toUnits(l.discountPercent)) / 1_000_000n
    payable += round2(net)
  }
  const rupees = ((payable + 5_000n) / 10_000n) * 10_000n
  return { payable: fromUnits(payable), roundOff: fromUnits(rupees - payable), grandTotal: fromUnits(rupees) }
}
const toQty = (q: string): bigint => { const [i = '0', f = ''] = q.split('.'); return BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, '0').slice(0, 6) || '0') }
