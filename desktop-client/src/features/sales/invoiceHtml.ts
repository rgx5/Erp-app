import type { Address, Invoice } from '@/api/schemas'
import { formatDate, formatInr } from '@/domain/format'
import { STATES } from '@/domain/india'
import { rupeesInWords } from '@/domain/words'
import { qrSvg, upiLink } from '@/features/retail/upiQr'

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const stateName = (code: string): string => (code === '96' ? 'Other country' : STATES.find((s) => s.code === code)?.name ?? code)
const pct = (v: string): string => `${Number(v)}%`
const TITLES: Record<string, string> = { tax_invoice: 'Tax Invoice', bill_of_supply: 'Bill of Supply', credit_note: 'Credit Note', debit_note: 'Debit Note' }

export interface Seller { name: string; tradeName?: string | null; gstin: string; address: string[]; stateCode: string; /** When set, tax invoices and bills of supply carry a pay-by-scanning QR for the amount. */ upiId?: string | null }

/**
 * A4 GST invoice as one self-contained HTML page (no scripts, no external files). Every value is escaped; amounts come exactly as the
 * server returned them and are only formatted, never recalculated.
 */
/** Lets the same layout serve the documents that are not tax invoices (quotation, proforma, sales order, delivery challan). */
export interface DocOptions { title?: string; numberLabel?: string; note?: string; noQr?: boolean; hidePrices?: boolean; hideTotals?: boolean; extraTop?: string }

export function invoiceHtml(inv: Invoice, seller: Seller, billTo: Address | undefined, opts: DocOptions = {}): string {
  const intra = inv.taxRegime === 'intra'
  const taxHeads = intra ? ['CGST', 'SGST'] : ['IGST']
  const rows = inv.lines.map((l) => `
    <tr>
      <td class="c">${l.lineNo}</td><td>${esc(l.description)}</td><td class="c">${esc(l.hsnSacCode ?? '')}</td>
      <td class="r">${esc(Number(l.quantity))}</td><td class="r">${formatInr(l.unitPrice, { symbol: false })}</td><td class="r">${Number(l.discountPercent) ? pct(l.discountPercent) : ''}</td>
      <td class="r">${formatInr(l.taxableValue, { symbol: false })}</td>
      ${intra ? `<td class="r">${pct(l.cgstRate)}<br>${formatInr(l.cgstAmount, { symbol: false })}</td><td class="r">${pct(l.sgstRate)}<br>${formatInr(l.sgstAmount, { symbol: false })}</td>` : `<td class="r">${pct(l.igstRate)}<br>${formatInr(l.igstAmount, { symbol: false })}</td>`}
      <td class="r">${formatInr(l.lineTotal, { symbol: false })}</td>
    </tr>`).join('')
  const total = (label: string, value: string): string => (Number(value) === 0 ? '' : `<tr><td>${label}</td><td class="r">${formatInr(value, { symbol: false })}</td></tr>`)
  const cancelled = inv.status === 'cancelled'
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.invoiceNo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; } body { font: 11px/1.4 Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 18px; margin: 0; text-align: center; letter-spacing: .5px; } .box { border: 1px solid #444; padding: 6px 8px; }
  .row { display: flex; gap: 0; } .row > div { flex: 1; } .row > div + div { border-left: 0; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #444; padding: 3px 5px; vertical-align: top; } th { background: #eee; font-size: 10px; }
  .r { text-align: right; font-variant-numeric: tabular-nums; } .c { text-align: center; } .muted { color: #555; } .big { font-size: 13px; font-weight: bold; }
  .watermark { position: fixed; top: 40%; left: 15%; font-size: 90px; color: rgba(200,0,0,.15); transform: rotate(-25deg); }
  .totals { width: 55%; margin-left: auto; } .totals td { border: 0; padding: 2px 5px; } .totals tr:last-child td { border-top: 1px solid #444; font-weight: bold; font-size: 13px; }
</style></head><body>
${cancelled ? '<div class="watermark">CANCELLED</div>' : ''}
<h1>${esc(opts.title ?? TITLES[inv.documentType] ?? inv.documentType)}</h1>
<div class="box" style="margin-top:6px"><div class="big">${esc(seller.name)}</div>${seller.tradeName ? `<div>(${esc(seller.tradeName)})</div>` : ''}
  <div>${seller.address.map(esc).join(', ')}</div><div>GSTIN: <b>${esc(seller.gstin)}</b> · State: ${esc(stateName(seller.stateCode))} (${esc(seller.stateCode)})</div></div>
<div class="row" style="margin-top:6px">
  <div class="box"><div class="muted">${esc(opts.numberLabel ?? 'Invoice no.')}</div><div class="big">${esc(inv.invoiceNo)}</div><div class="muted" style="margin-top:4px">Date</div><div>${esc(formatDate(inv.invoiceDate))}</div>${inv.dueDate ? `<div class="muted" style="margin-top:4px">Due date</div><div>${esc(formatDate(inv.dueDate))}</div>` : ''}</div>
  <div class="box"><div class="muted">Place of supply</div><div>${esc(stateName(inv.placeOfSupply))} (${esc(inv.placeOfSupply)})</div>${inv.reverseCharge ? '<div class="muted" style="margin-top:4px">Reverse charge</div><div>Yes: tax is payable by the recipient</div>' : ''}${inv.taxPayment === 'without_payment' ? '<div class="muted" style="margin-top:4px">Supply</div><div>Without payment of tax (under LUT / bond)</div>' : ''}</div>
</div>
<div class="box" style="margin-top:6px"><div class="muted">Bill to</div><div class="big">${esc(inv.customerName)}</div>
  ${billTo ? `<div>${esc([billTo.line1, billTo.line2, billTo.city, stateName(billTo.stateCode), billTo.pincode].filter(Boolean).join(', '))}</div>` : ''}
  ${inv.customerGstin ? `<div>GSTIN: <b>${esc(inv.customerGstin)}</b></div>` : ''}</div>
${opts.note ? `<div class="box" style="margin-top:6px"><b>${esc(opts.note)}</b></div>` : ''}
${opts.extraTop ?? ''}
${inv.reason ? `<div class="box" style="margin-top:6px"><span class="muted">Reason:</span> ${esc(inv.reason)}</div>` : ''}
<table style="margin-top:6px"><thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>Disc.</th><th>Taxable</th>${taxHeads.map((h) => `<th>${h}</th>`).join('')}<th>Total</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals" style="margin-top:6px"><tbody>
  ${total('Taxable value', inv.taxableTotal)}${intra ? total('CGST', inv.cgstTotal) + total('SGST', inv.sgstTotal) : total('IGST', inv.igstTotal)}${total('Cess', inv.cessTotal)}${total('Round off', inv.roundOff)}
  <tr><td>Grand total</td><td class="r">${formatInr(inv.grandTotal)}</td></tr></tbody></table>
<div class="box" style="margin-top:6px"><span class="muted">Amount in words:</span> <b>${esc(rupeesInWords(inv.grandTotal))}</b></div>
${seller.upiId && !opts.noQr && (inv.documentType === 'tax_invoice' || inv.documentType === 'bill_of_supply') && Number(inv.grandTotal) > 0 ? `<div class="box" style="margin-top:6px;display:flex;gap:10px;align-items:center">${qrSvg(upiLink(seller.upiId, seller.tradeName || seller.name, inv.grandTotal, inv.invoiceNo))}<div><b>Pay by UPI</b><br><span class="muted">Scan with any UPI app to pay ${esc(formatInr(inv.grandTotal))}<br>${esc(seller.upiId)}</span></div></div>` : ''}
<div class="row" style="margin-top:14px"><div class="muted">This is a computer generated document.</div><div class="r" style="margin-top:28px">For ${esc(seller.name)}<br><br>Authorised signatory</div></div>
</body></html>`
}
