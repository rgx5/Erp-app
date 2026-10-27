import { registerPostingRule, type Posting, type PostingLine } from '@/modules/postings'
import type { PackageSale, PackageUse } from './types'

/**
 * What a prepaid package means to the books.
 *   • Selling it is money received for services not yet given — a liability to the customer, the same account advances use:
 *     Dr cash / UPI / card / bank, Cr advances received (GST included, held for the customer).
 *   • Each session used releases its share: Dr advances received, Cr sales (the price without GST) and GST payable (CGST + SGST).
 *     A session paid for on a bill (the bill is paid with "package") has already booked the sale and GST; the use then clears the
 *     bill's tender instead: Dr advances received, Cr suspense — so revenue is recognised once, on the bill.
 *   • A package that lapses unused earns what is left (breakage) the same way a use does.
 *   • A session given back reverses the use, line for line.
 */
const paise = (n: number | undefined) => Math.round((Number(n) || 0) * 100)
const rupees = (p: number) => p / 100
const MONEY: Record<string, string> = { cash: 'cash', upi: 'upi', card: 'card', bank: 'bank' }

export function packageSalePosting(s: PackageSale): Posting | null {
  const money = MONEY[s.mode]
  const amount = paise(s.price)
  if (!money || amount <= 0) return null
  return {
    date: s.date, memo: `Package sold ${s.no} · ${s.name}`,
    lines: [{ account: money, debit: rupees(amount) }, { account: 'advances_received', credit: rupees(amount), party: { type: 'customer', id: s.customerId } }],
    ...(s.branchId ? { branchId: s.branchId } : {}),
  }
}

export function packageUsePosting(u: PackageUse): Posting | null {
  const value = Math.abs(paise(u.value)), tax = Math.abs(paise(u.tax))
  if (value + tax <= 0) return null
  const back = u.sessions < 0 || u.kind === 'reversal'
  const party = { type: 'customer' as const, id: u.customerId }
  const held: PostingLine = { account: 'advances_received', party, ...(back ? { credit: rupees(value + tax) } : { debit: rupees(value + tax) }) }
  const earn = (account: string, p: number): PostingLine[] => (p > 0 ? [{ account, ...(back ? { debit: rupees(p) } : { credit: rupees(p) }) }] : [])
  const lines: PostingLine[] = [held]
  if (u.billId) lines.push(...earn('suspense', value + tax))
  else {
    const cg = Math.round(tax / 2)
    lines.push(...earn('sales', value), ...earn('gst_output_cgst', cg), ...earn('gst_output_sgst', tax - cg))
  }
  const what = u.kind === 'expiry' ? 'Package expired' : u.kind === 'reversal' ? 'Package session given back' : 'Package session used'
  return { date: u.date, memo: `${what}${u.serviceName ? ` · ${u.serviceName}` : ''}`, lines, ...(u.branchId ? { branchId: u.branchId } : {}) }
}

registerPostingRule<PackageSale>('packageSales', (s) => packageSalePosting(s))
registerPostingRule<PackageUse>('packageUses', (u) => packageUsePosting(u))
