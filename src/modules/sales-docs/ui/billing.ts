import type { DiscountType } from '@/domain/types'
import { useCart } from '@/features/cart'
import { useApp } from '@/data/store'
import { ask, toast } from '@/ui/overlays'
import { EXT, type BillLink } from '../billhook'
import { cartLinesFor } from '../logic/convert'
import type { DocLine } from '../types'

/**
 * Turns a document into a bill at the counter: its lines (at the prices on the document), customer and discount go into the cart, and
 * the link says what the bill came from so saving it closes the document. Returns true when the cart was filled.
 */
export async function loadIntoCart(d: { items: DocLine[]; customerId: string | null; discountType: DiscountType; discountValue: number; link: BillLink }): Promise<boolean> {
  const { lines, warnings } = cartLinesFor(useApp.getState().data, d.items)
  if (!lines.length) { toast('None of these items are sold any more.', 'err'); return false }
  const cart = useCart.getState()
  if (cart.lines.length && !(await ask({ title: 'Replace the bill on the counter?', message: 'The items already in the cart will be removed.', confirm: 'Replace' }))) return false
  cart.clear()
  cart.setLines(lines)
  cart.set({ customerId: d.customerId, billDiscountType: d.discountType, billDiscountValue: d.discountValue })
  cart.setExtra(EXT, d.link)
  if (warnings.length) toast(warnings[0], 'info')
  return true
}
