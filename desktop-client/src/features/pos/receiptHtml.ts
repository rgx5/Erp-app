import type { PosSaleResult } from '@/api/schemas'
import { formatDate, formatInr } from '@/domain/format'
import type { Seller } from '@/features/sales/invoiceHtml'
import { bilingual } from '@/i18n'
import { getPaper, paperCss, type Paper } from './paper'

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' }

/** A narrow (80 mm) till receipt as a self-contained page. Every amount is the server's, only formatted. */
export function receiptHtml(sale: PosSaleResult, seller: Seller, paper: Paper = getPaper()): string {
  const doc = sale.invoice ?? sale.creditNote
  if (!doc) return ''
  const amt = (v: string): string => formatInr(v, { symbol: false })
  const lines = doc.lines.map((l) => `<tr><td colspan="3">${esc(l.description)}</td></tr><tr><td>${esc(Number(l.quantity))} x ${amt(l.unitPrice)}${Number(l.discountPercent) ? ` (-${Number(l.discountPercent)}%)` : ''}</td><td></td><td class="r">${amt(l.lineTotal)}</td></tr>`).join('')
  const tax = (label: string, v: string): string => (Number(v) === 0 ? '' : `<tr><td>${label}</td><td class="r">${amt(v)}</td></tr>`)
  const pays = sale.payments.map((p) => `<tr><td>${esc(METHOD[p.method] ?? p.method)}</td><td class="r">${amt(p.amount)}</td></tr>`).join('')
  const W: Record<string, string> = { store_credit_used: 'Store credit used', store_credit_issued: 'Kept as store credit', points_redeemed: 'Points redeemed', coupon: 'Coupon saved' }
  const wallet = (sale.wallet ?? []).filter((w) => w.kind !== 'points_earned').map((w) => `<tr><td>${esc(W[w.kind] ?? w.kind)}${w.kind === 'coupon' && w.reference ? ` ${esc(w.reference)}` : ''}${w.kind === 'points_redeemed' && w.points ? ` (${esc(Number(w.points))})` : ''}</td><td class="r">${amt(w.amount)}</td></tr>`).join('')
  const earned = (sale.wallet ?? []).find((w) => w.kind === 'points_earned')
  const title = bilingual(doc.documentType === 'credit_note' ? 'Credit Note' : 'Tax Invoice')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.invoiceNo)}</title>
<style>${paperCss(paper)}h1{font-size:13px;margin:0;text-align:center}.c{text-align:center}.r{text-align:right}table{width:100%;border-collapse:collapse}hr{border:0;border-top:1px dashed #000;margin:4px 0}.b{font-weight:700}</style></head><body>
<h1>${esc(seller.tradeName || seller.name)}</h1><div class="c">${seller.address.map(esc).join(', ')}<br>GSTIN ${esc(seller.gstin)}</div><hr>
<div class="c b">${title}</div><table><tr><td>${esc(doc.invoiceNo)}</td><td class="r">${esc(formatDate(doc.invoiceDate))}</td></tr></table><hr>
<table>${lines}</table><hr>
<table><tr><td>${esc(bilingual('Taxable value'))}</td><td class="r">${amt(doc.taxableTotal)}</td></tr>${tax('CGST', doc.cgstTotal)}${tax('SGST', doc.sgstTotal)}${tax('IGST', doc.igstTotal)}${tax('Cess', doc.cessTotal)}${tax('Round off', doc.roundOff)}
<tr class="b"><td>${esc(bilingual('TOTAL'))}</td><td class="r">${amt(doc.grandTotal)}</td></tr></table><hr>
<table>${pays}${wallet}${sale.changeDue && Number(sale.changeDue) > 0 ? `<tr><td>${esc(bilingual('Change'))}</td><td class="r">${amt(sale.changeDue)}</td></tr>` : ''}</table><hr>
${earned?.points ? `<div class="c">You earned ${esc(Number(earned.points))} points</div>` : ''}<div class="c">${esc(bilingual('Thank you'))}</div></body></html>`
}
