import type { Address, Invoice } from '@/api/schemas'
import { formatDate, formatInr } from '@/domain/format'
import { STATES } from '@/domain/india'
import { bilingual } from '@/i18n'
import { rupeesInWords } from '@/domain/words'
import { qrSvg, upiLink } from '@/features/retail/upiQr'

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const stateName = (code: string): string => (code === '96' ? 'Other country' : STATES.find((s) => s.code === code)?.name ?? code)
const pct = (v: string): string => `${Number(v)}%`
const TITLES: Record<string, string> = { tax_invoice: 'Tax Invoice', bill_of_supply: 'Bill of Supply', credit_note: 'Credit Note', debit_note: 'Debit Note' }

export interface Seller { name: string; tradeName?: string | null; gstin: string; address: string[]; stateCode: string; /** When set, tax invoices and bills of supply carry a pay-by-scanning QR for the amount. */ upiId?: string | null }

/**
 * A4 GST document as one self-contained HTML page (no scripts, no external files): quiet type, one accent colour, thin rules instead of boxes.
 * Every value is escaped; amounts come exactly as the server returned them and are only formatted, never recalculated.
 */
/** Lets the same layout serve the documents that are not tax invoices (quotation, proforma, sales order, delivery challan). */
export interface DocOptions { title?: string; numberLabel?: string; note?: string; noQr?: boolean; /** Extra facts shown beside the dates (for a challan: vehicle, transporter). */ extraMeta?: [string, string][]; /** What the e-invoice portal returned: printed with its QR code. */ einvoice?: { irn: string; ackNo: string; ackDate: string; signedQr: string } | null; ewayBillNo?: string | null }

/** The look every printed document shares, so an invoice, a quotation and a challan read as one family. */
export const DOC_CSS = `
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #000; font: 500 11px/1.5 "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  b, .strong { font-weight: 700; } .muted b { color: #000; }
  .muted { color: #374151; } .r { text-align: right; } .num { font-variant-numeric: tabular-nums; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid #1f3a5f; }
  .seller .name { font-size: 17px; font-weight: 700; } .seller div + div { margin-top: 1px; }
  .title { text-align: right; } .title .kind { font-size: 12px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: #1f3a5f; }
  .title .no { font-size: 18px; font-weight: 700; margin: 2px 0 6px; }
  .meta { display: grid; grid-template-columns: auto auto; gap: 1px 14px; justify-content: end; } .meta dt { color: #374151; text-align: right; } .meta dd { margin: 0; text-align: right; font-weight: 600; }
  .parties { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 24px; padding: 14px 0; border-bottom: 1px solid #6b7280; }
  .label { font-size: 9.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #1f2937; margin-bottom: 3px; } .strong { font-size: 12px; }
  .note { margin-top: 12px; padding: 5px 10px; border-left: 3px solid #1f3a5f; background: #eef0f3; color: #111827; font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 14px; }
  table.items th { padding: 0 6px 6px; text-align: right; font-size: 9.5px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: #111827; border-bottom: 1.5px solid #000; }
  table.items th:nth-child(1), table.items th:nth-child(2) { text-align: left; }
  table.items td { padding: 7px 6px; border-bottom: 1px solid #9ca3af; vertical-align: top; text-align: right; font-variant-numeric: tabular-nums; }
  table.items td:nth-child(1) { text-align: left; color: #374151; width: 22px; padding-left: 0; } table.items td:nth-child(2) { text-align: left; } table.items th:last-child, table.items td:last-child { padding-right: 0; font-weight: 700; }
  table.items tr { page-break-inside: avoid; } .sub { color: #374151; font-size: 9.5px; font-weight: 500; }
  .summary { display: flex; justify-content: space-between; gap: 32px; margin-top: 14px; page-break-inside: avoid; }
  .words { flex: 1; } .words .t { margin-top: 2px; font-weight: 700; }
  .totals { width: 46%; } .totals div { display: flex; justify-content: space-between; padding: 2px 0; } .totals .grand { margin-top: 6px; padding-top: 8px; border-top: 1.5px solid #000; font-size: 15px; font-weight: 700; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-top: 22px; padding-top: 14px; border-top: 1px solid #6b7280; page-break-inside: avoid; }
  .pay { display: flex; gap: 10px; align-items: center; } .pay + .pay { margin-top: 10px; } .pay .small { font-size: 9.5px; word-break: break-all; }
  .sign { text-align: right; min-width: 190px; font-weight: 600; } .sign .line { margin-top: 38px; padding-top: 4px; border-top: 1px solid #111; color: #374151; font-weight: 500; }
  .fine { margin-top: 18px; text-align: center; font-size: 9.5px; color: #4b5563; }
  .watermark { position: fixed; top: 38%; left: 12%; font-size: 96px; font-weight: 800; letter-spacing: 6px; color: rgba(185, 28, 28, .16); transform: rotate(-24deg); pointer-events: none; }`

export function invoiceHtml(inv: Invoice, seller: Seller, billTo: Address | undefined, opts: DocOptions = {}): string {
  const intra = inv.taxRegime === 'intra'
  const cancelled = inv.status === 'cancelled'
  const kind = opts.title ?? TITLES[inv.documentType] ?? inv.documentType
  const rows = inv.lines.map((l) => {
    const rate = intra ? Number(l.cgstRate) + Number(l.sgstRate) : Number(l.igstRate)
    const tax = intra ? Number(l.cgstAmount) + Number(l.sgstAmount) : Number(l.igstAmount)
    return `<tr><td>${l.lineNo}</td><td>${esc(l.description)}${l.hsnSacCode ? `<div class="sub">${esc(bilingual('HSN/SAC'))} ${esc(l.hsnSacCode)}</div>` : ''}</td>
      <td>${esc(Number(l.quantity))}</td><td>${formatInr(l.unitPrice, { symbol: false })}</td><td>${Number(l.discountPercent) ? pct(l.discountPercent) : ''}</td>
      <td>${formatInr(l.taxableValue, { symbol: false })}</td><td>${rate ? `${rate}%<div class="sub">${formatInr(String(tax), { symbol: false })}</div>` : ''}</td><td>${formatInr(l.lineTotal, { symbol: false })}</td></tr>`
  }).join('')
  const line = (label: string, value: string): string => (Number(value) === 0 ? '' : `<div><span class="muted">${label}</span><span class="num">${formatInr(value, { symbol: false })}</span></div>`)
  const meta: [string, string][] = [[bilingual('Date'), formatDate(inv.invoiceDate)], ...(inv.dueDate ? [['Due date', formatDate(inv.dueDate)] as [string, string]] : []), ...(opts.extraMeta ?? [])]
  const supply = [inv.reverseCharge ? 'Reverse charge: tax is payable by the recipient' : '', inv.taxPayment === 'without_payment' ? 'Supply without payment of tax' : '', inv.taxPayment === 'with_payment' && inv.supplyType === 'export' ? 'Export with payment of tax' : ''].filter(Boolean)
  const showUpi = seller.upiId && !opts.noQr && (inv.documentType === 'tax_invoice' || inv.documentType === 'bill_of_supply') && Number(inv.grandTotal) > 0
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.invoiceNo)}</title><style>${DOC_CSS}</style></head><body>
${cancelled ? '<div class="watermark">CANCELLED</div>' : ''}
<div class="head">
  <div class="seller"><div class="name">${esc(seller.name)}</div>${seller.tradeName ? `<div class="muted">${esc(seller.tradeName)}</div>` : ''}
    <div class="muted">${seller.address.map(esc).join(', ')}</div><div class="muted">GSTIN <b>${esc(seller.gstin)}</b></div></div>
  <div class="title"><div class="kind">${esc(bilingual(kind))}</div><div class="no">${esc(inv.invoiceNo)}</div>
    <dl class="meta">${meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
</div>
<div class="parties">
  <div><div class="label">${esc(bilingual('Bill to'))}</div><div class="strong">${esc(inv.customerName)}</div>
    ${billTo ? `<div class="muted">${esc([billTo.line1, billTo.line2, billTo.city, stateName(billTo.stateCode), billTo.pincode].filter(Boolean).join(', '))}</div>` : ''}
    ${inv.customerGstin ? `<div class="muted">GSTIN <b>${esc(inv.customerGstin)}</b></div>` : ''}</div>
  <div><div class="label">${esc(bilingual('Place of supply'))}</div><div>${esc(stateName(inv.placeOfSupply))} (${esc(inv.placeOfSupply)})</div>${supply.map((t) => `<div class="muted">${esc(t)}</div>`).join('')}</div>
  <div>${opts.ewayBillNo ? `<div class="label">E-way bill</div><div class="num">${esc(opts.ewayBillNo)}</div>` : ''}</div>
</div>
${opts.note ? `<div class="note">${esc(opts.note)}</div>` : ''}
${inv.reason ? `<div class="note"><span class="muted">Reason:</span> ${esc(inv.reason)}</div>` : ''}
<table class="items"><thead><tr><th>#</th><th>${esc(bilingual('Description'))}</th><th>${esc(bilingual('Qty'))}</th><th>${esc(bilingual('Rate'))}</th><th>${esc(bilingual('Disc.'))}</th><th>${esc(bilingual('Taxable'))}</th><th>GST</th><th>${esc(bilingual('Total'))}</th></tr></thead><tbody>${rows}</tbody></table>
<div class="summary">
  <div class="words"><div class="label">${esc(bilingual('Amount in words'))}</div><div class="t">${esc(rupeesInWords(inv.grandTotal))}</div></div>
  <div class="totals">${line(bilingual('Taxable value'), inv.taxableTotal)}${intra ? line('CGST', inv.cgstTotal) + line('SGST', inv.sgstTotal) : line('IGST', inv.igstTotal)}${line('Cess', inv.cessTotal)}${line(bilingual('Round off'), inv.roundOff)}
    <div class="grand"><span>${esc(bilingual('Grand total'))}</span><span class="num">${formatInr(inv.grandTotal)}</span></div></div>
</div>
<div class="foot">
  <div>
    ${opts.einvoice ? `<div class="pay">${qrSvg(opts.einvoice.signedQr, 28)}<div class="small"><div class="label">${esc(bilingual('E-invoice'))}</div>IRN ${esc(opts.einvoice.irn)}<br>Ack ${esc(opts.einvoice.ackNo)} · ${esc(new Date(opts.einvoice.ackDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }))}</div></div>` : ''}
    ${showUpi ? `<div class="pay">${qrSvg(upiLink(seller.upiId as string, seller.tradeName || seller.name, inv.grandTotal, inv.invoiceNo), 22)}<div><div class="label">${esc(bilingual('Pay by UPI'))}</div>Scan to pay ${esc(formatInr(inv.grandTotal))}<div class="muted">${esc(seller.upiId as string)}</div></div></div>` : ''}
  </div>
  <div class="sign"><div>For ${esc(seller.name)}</div><div class="line">${esc(bilingual('Authorised signatory'))}</div></div>
</div>
<div class="fine">${esc(bilingual('This is a computer generated document.'))}</div>
</body></html>`
}
