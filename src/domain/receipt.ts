import type { Bill, Customer, StoreSettings, User } from './types'
import { amountInWords, inr, round2 } from './money'
import { gstinState, stateName, taxInfoOf } from './gst'
import { fmtDateTime, fmtDate } from './dates'
import { fmtQty, unitSuffix } from './qty'
import { hsnSummary } from './tax'
import { variantLabel } from './codes'
import { firstName } from './people'

/** What a printed bill shows. A GST tax invoice normally carries the CGST/SGST split and an HSN summary, so those are opt-in
 *  on the thermal receipt — and the A4 invoice always shows them. */
export interface ReceiptOptions { showTax: boolean; showHsn: boolean; showSavings: boolean; showLoyalty: boolean }

export function receiptOptions(s: Partial<Pick<StoreSettings, 'receiptShowTax' | 'receiptShowHsn' | 'receiptShowSavings' | 'receiptShowLoyalty'>>): ReceiptOptions {
  return { showTax: s.receiptShowTax === true, showHsn: s.receiptShowHsn === true, showSavings: s.receiptShowSavings !== false, showLoyalty: s.receiptShowLoyalty !== false }
}

/** What modules add to a printed bill (see `registerReceiptExtra`): lines under the header, a note per item, lines above the footer. */
export interface ReceiptAddOns { header: string[]; footer: string[]; item?: (item: Bill['items'][number]) => string | null }
export interface DocContext { bill: Bill; store: StoreSettings; customer?: Customer | null; seller?: User | null; labels?: { sale?: string }; extras?: ReceiptAddOns }

export const esc = (s: string | number | undefined | null) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const isCreditNote = (b: Bill) => !!b.refundOfBillId || b.total < 0

/** How a bill's tax is laid out: a bill of supply shows none, an inter-state bill shows IGST, a local one CGST + SGST. */
export function taxLayout(b: Bill): { billOfSupply: boolean; igst: boolean; igstTotal: number; info: ReturnType<typeof taxInfoOf> } {
  const info = taxInfoOf(b)
  const igstTotal = round2(b.igstTotal ?? b.items.reduce((s, i) => s + (i.igst ?? 0), 0))
  return { billOfSupply: info.taxMode === 'bill_of_supply', igst: b.igstTotal !== undefined || b.items.some((i) => i.igst !== undefined), igstTotal, info }
}
const docTitle = (b: Bill) => (isCreditNote(b) ? 'CREDIT NOTE' : taxLayout(b).billOfSupply ? 'BILL OF SUPPLY' : 'TAX INVOICE')
const sign = (b: Bill) => (isCreditNote(b) ? -1 : 1)

/** How a tender line is named on paper and in lists: Cash, UPI, Card, Store credit, Points. */
export function payLabel(p: { mode: string; ref?: string }): string {
  if (p.mode === 'credit') return p.ref ? 'Points' : 'Store credit'
  return p.mode === 'upi' ? 'UPI' : p.mode.charAt(0).toUpperCase() + p.mode.slice(1)
}

/** The tender lines, in words: "Cash ₹500 · UPI ₹499". */
export function paymentSummary(b: Bill): string {
  return b.payments.map((p) => `${payLabel(p)} ${inr(Math.abs(p.amount), 0)}`).join(' · ')
}

// ───────────────────────────── plain text (WhatsApp / SMS) ─────────────────────────────

export function receiptText({ bill, store, customer, extras }: DocContext): string {
  const credit = isCreditNote(bill)
  const lines: string[] = []
  lines.push(`*${store.name}*`)
  if (store.city) lines.push(store.city)
  lines.push(`${credit ? 'Credit note' : taxLayout(bill).billOfSupply ? 'Bill of supply' : 'Bill'} ${bill.no} · ${fmtDate(bill.date)}`)
  for (const h of extras?.header ?? []) lines.push(h)
  if (customer?.name) lines.push(`Hi ${firstName(customer.name)},`)
  lines.push('')
  for (const i of bill.items) {
    const lbl = variantLabel(i.size, i.color)
    lines.push(`• ${i.name}${lbl ? ` (${lbl})` : ''} × ${fmtQty(i.qty)}${unitSuffix(i)} — ${inr(Math.abs(i.lineTotal), 0)}`)
    const note = extras?.item?.(i)
    if (note) lines.push(`   ${note}`)
  }
  lines.push('')
  if (bill.billDiscount > 0 || bill.itemDiscount > 0) lines.push(`You saved ${inr(bill.grossMrp - bill.subtotal, 0)}`)
  lines.push(`*${credit ? 'Refund' : 'Total'}: ${inr(Math.abs(bill.total), 0)}*`)
  if (bill.payments.length) lines.push(`Paid by ${paymentSummary(bill)}`)
  if (bill.loyaltyEarned > 0) lines.push(`⭐ You earned ${bill.loyaltyEarned} loyalty points`)
  for (const f of extras?.footer ?? []) lines.push(f)
  if (store.footerNote) { lines.push(''); lines.push(store.footerNote) }
  if (store.phone) lines.push(`📞 ${store.phone}`)
  return lines.join('\n')
}

// ───────────────────────────── thermal-style receipt (HTML) ─────────────────────────────

const base = (width: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box}body{margin:0;padding:12px;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;font-size:12px;line-height:1.35;width:${width};margin-inline:auto}
  h1{font-size:16px;margin:0;text-align:center}h2{font-size:13px;margin:8px 0 2px;text-align:center;letter-spacing:.5px}
  .c{text-align:center}.r{text-align:right}.muted{color:#555}.b{font-weight:700}.sm{font-size:11px}
  hr{border:0;border-top:1px dashed #999;margin:8px 0}
  table{width:100%;border-collapse:collapse}td,th{padding:2px 0;vertical-align:top}th{text-align:left;font-size:11px;color:#555;border-bottom:1px solid #ccc}
  .row{display:flex;justify-content:space-between;gap:8px}.tot{font-size:15px;font-weight:800}
</style></head><body>${body}</body></html>`

export function receiptHtml(ctx: DocContext, opts: ReceiptOptions = receiptOptions(ctx.store)): string {
  const { bill, store, customer, seller, extras } = ctx
  const credit = isCreditNote(bill)
  const s = sign(bill)
  const saved = round2(bill.grossMrp - bill.subtotal)
  const lay = taxLayout(bill)
  const buyerGstin = lay.info.buyerGstin || customer?.gstin || ''
  const pos = lay.info.placeOfSupply || gstinState(buyerGstin)
  const rows = bill.items.map((i) => {
    const lbl = variantLabel(i.size, i.color)
    return `<tr><td colspan="3"><span class="b">${esc(i.name)}</span>${lbl ? ` <span class="muted">${esc(lbl)}</span>` : ''}</td></tr>
      <tr><td class="muted sm">${esc(fmtQty(i.qty))}${esc(unitSuffix(i))} × ${esc(inr(i.price, 2))}${i.discountAmount > 0 ? ` <span>(−${esc(inr(i.discountAmount, 0))})</span>` : ''}</td><td></td><td class="r b">${esc(inr(Math.abs(i.lineTotal), 2))}</td></tr>${extras?.item?.(i) ? `<tr><td colspan="3" class="muted sm">${esc(extras.item(i))}</td></tr>` : ''}`
  }).join('')
  const hsn = opts.showHsn && !lay.billOfSupply ? hsnSummary(bill.items.map((i) => ({ ...i, qty: i.qty }))) : []
  const body = `
    <h1>${esc(store.name)}</h1>
    ${store.tagline ? `<div class="c muted sm">${esc(store.tagline)}</div>` : ''}
    ${[store.address, store.city].filter(Boolean).length ? `<div class="c sm">${esc([store.address, store.city].filter(Boolean).join(', '))}</div>` : ''}
    ${store.phone ? `<div class="c sm">Ph: ${esc(store.phone)}</div>` : ''}${store.gstin ? `<div class="c sm">GSTIN: ${esc(store.gstin)}</div>` : ''}
    <h2>${docTitle(bill)}</h2><hr>
    <div class="row sm"><span>${esc(bill.no)}</span><span>${esc(fmtDateTime(bill.date))}</span></div>
    ${customer ? `<div class="sm">Customer: ${esc(customer.name)}${customer.phone ? ` · ${esc(customer.phone)}` : ''}</div>` : ''}
    ${buyerGstin ? `<div class="sm">Buyer GSTIN: ${esc(buyerGstin)}</div>` : ''}${pos && !lay.billOfSupply ? `<div class="sm">Place of supply: ${esc(stateName(pos) || pos)} (${esc(pos)})</div>` : ''}${lay.info.reverseCharge ? `<div class="sm b">Tax payable on reverse charge basis</div>` : ''}
    ${seller ? `<div class="sm muted">Served by ${esc(seller.name)}</div>` : ''}
    ${(extras?.header ?? []).map((h) => `<div class="sm">${esc(h)}</div>`).join('')}
    <hr><table>${rows}</table><hr>
    ${bill.grossMrp > bill.subtotal && !credit ? `<div class="row sm"><span>Total MRP</span><span>${esc(inr(bill.grossMrp, 2))}</span></div>` : ''}
    ${bill.itemDiscount + bill.billDiscount > 0 ? `<div class="row sm"><span>Discount${bill.coupon ? ` (${esc(bill.coupon)})` : ''}</span><span>−${esc(inr(bill.itemDiscount + bill.billDiscount, 2))}</span></div>` : ''}
    ${opts.showTax && !lay.billOfSupply ? `<div class="row sm"><span>Taxable value</span><span>${esc(inr(Math.abs(bill.taxableTotal), 2))}</span></div>${lay.igst ? `<div class="row sm"><span>IGST</span><span>${esc(inr(Math.abs(lay.igstTotal), 2))}</span></div>` : `<div class="row sm"><span>CGST</span><span>${esc(inr(Math.abs(bill.cgstTotal), 2))}</span></div><div class="row sm"><span>SGST</span><span>${esc(inr(Math.abs(bill.sgstTotal), 2))}</span></div>`}` : ''}${lay.billOfSupply && store.registrationType === 'composition' ? `<div class="sm muted">Composition taxable person, not eligible to collect tax on supplies.</div>` : ''}
    ${bill.roundOff ? `<div class="row sm"><span>Round off</span><span>${esc(inr(bill.roundOff * s, 2))}</span></div>` : ''}
    <div class="row tot"><span>${credit ? 'REFUND' : 'TOTAL'}</span><span>${esc(inr(Math.abs(bill.total), 2))}</span></div>
    ${bill.payments.length ? `<div class="sm muted" style="margin-top:4px">${esc(paymentSummary(bill))}${bill.changeDue > 0 ? ` · Change ${esc(inr(bill.changeDue, 2))}` : ''}</div>` : ''}
    ${opts.showSavings && saved > 0 && !credit ? `<div class="c b" style="margin-top:6px">You saved ${esc(inr(saved, 2))}!</div>` : ''}
    ${opts.showLoyalty && bill.loyaltyEarned > 0 ? `<div class="c sm">⭐ +${bill.loyaltyEarned} loyalty points earned</div>` : ''}
    ${(extras?.footer ?? []).map((f) => `<div class="c sm">${esc(f)}</div>`).join('')}
    ${hsn.length ? `<hr><table><tr><th>HSN</th><th>Rate</th><th class="r">Taxable</th><th class="r">Tax</th></tr>${hsn.map((h) => `<tr class="sm"><td>${esc(h.hsn)}</td><td>${h.rate}%</td><td class="r">${esc(inr(h.taxable, 2))}</td><td class="r">${esc(inr(round2(h.cgst + h.sgst + (h.igst ?? 0)), 2))}</td></tr>`).join('')}</table>` : ''}
    <hr>${store.returnPolicy ? `<div class="c sm muted">${esc(store.returnPolicy)}</div>` : ''}
    ${store.footerNote ? `<div class="c b" style="margin-top:6px">${esc(store.footerNote)}</div>` : ''}`
  return base(store.receiptWidth === '58mm' ? '58mm' : '80mm', body)
}

// ───────────────────────────── A4 GST tax invoice ─────────────────────────────

export function invoiceHtml(ctx: DocContext): string {
  const { bill, store, customer, seller, extras } = ctx
  const credit = isCreditNote(bill)
  const lay = taxLayout(bill)
  const bos = lay.billOfSupply
  const buyerGstin = lay.info.buyerGstin || customer?.gstin || ''
  const pos = lay.info.placeOfSupply || gstinState(buyerGstin)
  const taxCols = (i: Bill['items'][number]) => (bos ? '' : lay.igst ? `<td class="r">${esc(inr(Math.abs(i.igst ?? 0)))}</td>` : `<td class="r">${esc(inr(Math.abs(i.cgst)))}</td><td class="r">${esc(inr(Math.abs(i.sgst)))}</td>`)
  const rows = bill.items.map((i, n) => `<tr>
      <td>${n + 1}</td><td><b>${esc(i.name)}</b><div class="muted sm">${esc(variantLabel(i.size, i.color))}</div>${extras?.item?.(i) ? `<div class="muted sm">${esc(extras.item(i))}</div>` : ''}</td><td>${esc(i.hsn || '—')}</td>
      <td class="r">${esc(fmtQty(i.qty))}${esc(unitSuffix(i))}</td><td class="r">${esc(inr(i.price))}</td>${bos ? '' : `<td class="r">${esc(inr(Math.abs(i.taxable)))}</td>`}
      ${bos ? '' : `<td class="r">${i.taxRate}%</td>`}${taxCols(i)}<td class="r b">${esc(inr(Math.abs(i.lineTotal)))}</td></tr>`).join('')
  const hsn = hsnSummary(bill.items)
  const body = `
  <style>@page{size:A4;margin:14mm}body{font-size:12px;padding:0;width:auto}table.items td,table.items th{border:1px solid #bbb;padding:5px 6px}table.items th{background:#f2f2f2;color:#111}.box{border:1px solid #bbb;padding:8px 10px;border-radius:4px}.grid{display:flex;gap:12px}.grid>div{flex:1}</style>
  <div class="row"><div><h1 style="text-align:left;font-size:22px">${esc(store.name)}</h1>
    <div class="muted">${esc([store.address, store.city].filter(Boolean).join(', '))}</div>
    ${store.phone ? `<div>Ph: ${esc(store.phone)}${store.email ? ` · ${esc(store.email)}` : ''}</div>` : ''}${store.gstin ? `<div class="b">GSTIN: ${esc(store.gstin)}</div>` : ''}</div>
    <div class="r"><div style="font-size:18px;font-weight:800;letter-spacing:1px">${docTitle(bill)}</div><div>No. <b>${esc(bill.no)}</b></div><div>Date: ${esc(fmtDate(bill.date))}</div></div></div>
  <div class="grid" style="margin:12px 0"><div class="box"><div class="muted sm">BILLED TO</div><b>${esc(customer?.name ?? 'Walk-in customer')}</b>
    ${customer?.phone ? `<div>${esc(customer.phone)}</div>` : ''}${customer?.address ? `<div class="muted">${esc(customer.address)}</div>` : ''}${buyerGstin ? `<div>GSTIN: ${esc(buyerGstin)}</div>` : ''}${pos && !bos ? `<div>Place of supply: ${esc(stateName(pos) || pos)} (${esc(pos)})</div>` : ''}${!bos && buyerGstin ? `<div>Reverse charge: ${lay.info.reverseCharge ? 'Yes' : 'No'}</div>` : ''}</div>
    <div class="box"><div class="muted sm">DETAILS</div>${seller ? `<div>Served by ${esc(seller.name)}</div>` : ''}<div>Payment: ${esc(paymentSummary(bill) || '—')}</div>${[...(extras?.header ?? []), ...(extras?.footer ?? [])].map((h) => `<div>${esc(h)}</div>`).join('')}</div></div>
  <table class="items"><tr><th>#</th><th>Item</th><th>HSN</th><th class="r">Qty</th><th class="r">Rate</th>${bos ? '' : `<th class="r">Taxable</th><th class="r">GST</th>${lay.igst ? '<th class="r">IGST</th>' : '<th class="r">CGST</th><th class="r">SGST</th>'}`}<th class="r">Amount</th></tr>${rows}</table>
  <div class="grid" style="margin-top:12px"><div>
    ${bos ? `<div class="muted sm">${store.registrationType === 'composition' ? 'Composition taxable person, not eligible to collect tax on supplies.' : 'Issued by a supplier not registered for GST — no tax is charged.'}</div>` : `<table class="items"><tr><th>HSN</th><th class="r">Taxable</th><th class="r">Rate</th>${lay.igst ? '<th class="r">IGST</th>' : '<th class="r">CGST</th><th class="r">SGST</th>'}</tr>${hsn.map((h) => `<tr><td>${esc(h.hsn)}</td><td class="r">${esc(inr(Math.abs(h.taxable)))}</td><td class="r">${h.rate}%</td>${lay.igst ? `<td class="r">${esc(inr(Math.abs(h.igst ?? 0)))}</td>` : `<td class="r">${esc(inr(Math.abs(h.cgst)))}</td><td class="r">${esc(inr(Math.abs(h.sgst)))}</td>`}</tr>`).join('')}</table>`}</div>
    <div class="box">
      <div class="row"><span>Subtotal</span><span>${esc(inr(Math.abs(bill.subtotal)))}</span></div>
      ${bill.billDiscount > 0 ? `<div class="row"><span>Bill discount</span><span>−${esc(inr(bill.billDiscount))}</span></div>` : ''}
      ${bos ? '' : `<div class="row"><span>Taxable value</span><span>${esc(inr(Math.abs(bill.taxableTotal)))}</span></div>
      <div class="row"><span>${lay.igst ? 'IGST' : 'CGST + SGST'}</span><span>${esc(inr(Math.abs(bill.taxTotal)))}</span></div>`}
      ${bill.roundOff ? `<div class="row"><span>Round off</span><span>${esc(inr(bill.roundOff * sign(bill)))}</span></div>` : ''}
      <div class="row tot" style="border-top:1px solid #999;margin-top:4px;padding-top:4px"><span>${credit ? 'Refund' : 'Total'}</span><span>${esc(inr(Math.abs(bill.total)))}</span></div></div></div>
  <p style="margin-top:10px"><b>Amount in words:</b> ${esc(amountInWords(Math.abs(bill.total)))}</p>
  <div class="grid" style="margin-top:16px"><div class="muted sm">${esc(store.returnPolicy)}</div><div class="r"><div style="height:44px"></div><div>Authorised signatory</div><div class="b">${esc(store.name)}</div></div></div>
  ${store.footerNote ? `<p class="c muted">${esc(store.footerNote)}</p>` : ''}`
  return base('100%', body)
}
