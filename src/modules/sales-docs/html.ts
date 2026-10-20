import { variantLabel } from '@/domain/codes'
import { fmtDate, fmtDateTime } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { esc } from '@/domain/receipt'
import type { StoreSettings } from '@/domain/types'
import { docTotals } from './logic/lines'
import { CHALLAN_LABEL } from './logic/challans'
import { QUOTE_LABEL } from './logic/quotes'
import { ORDER_LABEL, type OrderMoney } from './logic/orders'
import type { Shift } from './types'
import type { ShiftFigures } from './logic/shifts'
import type { Challan, Quotation, SalesOrder } from './types'

type Store = Pick<StoreSettings, 'name' | 'tagline' | 'address' | 'city' | 'phone' | 'email' | 'gstin' | 'slabs' | 'priceIncludesTax'>

const CSS = `*{box-sizing:border-box}body{margin:0;padding:24px;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;font-size:12px;line-height:1.4}
h1{font-size:22px;margin:0}.muted{color:#555}.sm{font-size:11px}.r{text-align:right}.b{font-weight:700}.row{display:flex;justify-content:space-between;gap:12px}
.box{border:1px solid #bbb;border-radius:4px;padding:8px 10px}.grid{display:flex;gap:12px;margin:12px 0}.grid>div{flex:1}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px 6px;vertical-align:top}th{background:#f2f2f2;text-align:left;font-size:11px}
.tot{font-size:15px;font-weight:800}@page{size:A4;margin:14mm}`

interface DocView {
  title: string
  no: string
  date: number
  store: Store
  party: { name: string; phone?: string; address?: string; gstin?: string }
  /** Extra "label: value" pairs shown on the right of the header. */
  meta?: Array<[string, string]>
  lines: Array<{ name: string; variant?: string; qty: number; unit?: string; price?: number; amount?: number }>
  /** Totals block rows. Omit to print no prices (a challan). */
  totals?: Array<[string, string, boolean?]>
  notes?: string
  terms?: string
  footer?: string
}

const unit = (u?: string) => (u && u !== 'pc' ? ` ${esc(u)}` : '')

/** One layout for every sales document, in the style of the A4 tax invoice. */
export function renderDocHtml(d: DocView): string {
  const priced = d.lines.some((l) => l.price !== undefined)
  const rows = d.lines.map((l, n) => `<tr><td>${n + 1}</td><td><b>${esc(l.name)}</b>${l.variant ? `<div class="muted sm">${esc(l.variant)}</div>` : ''}</td><td class="r">${esc(fmtQty(l.qty))}${unit(l.unit)}</td>${priced ? `<td class="r">${esc(inr(l.price ?? 0))}</td><td class="r b">${esc(inr(l.amount ?? 0))}</td>` : ''}</tr>`).join('')
  const s = d.store
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>
  <div class="row"><div><h1>${esc(s.name)}</h1>${s.tagline ? `<div class="muted">${esc(s.tagline)}</div>` : ''}<div class="muted">${esc([s.address, s.city].filter(Boolean).join(', '))}</div>
    ${s.phone ? `<div>Ph: ${esc(s.phone)}${s.email ? ` · ${esc(s.email)}` : ''}</div>` : ''}${s.gstin ? `<div class="b">GSTIN: ${esc(s.gstin)}</div>` : ''}</div>
    <div class="r"><div style="font-size:18px;font-weight:800;letter-spacing:1px">${esc(d.title)}</div><div>No. <b>${esc(d.no)}</b></div><div>Date: ${esc(fmtDate(d.date))}</div>${(d.meta ?? []).map(([k, v]) => `<div>${esc(k)}: ${esc(v)}</div>`).join('')}</div></div>
  <div class="grid"><div class="box"><div class="muted sm">FOR</div><b>${esc(d.party.name || 'Walk-in customer')}</b>${d.party.phone ? `<div>${esc(d.party.phone)}</div>` : ''}${d.party.address ? `<div class="muted">${esc(d.party.address)}</div>` : ''}${d.party.gstin ? `<div>GSTIN: ${esc(d.party.gstin)}</div>` : ''}</div></div>
  <table><tr><th>#</th><th>Item</th><th class="r">Qty</th>${priced ? '<th class="r">Rate</th><th class="r">Amount</th>' : ''}</tr>${rows}</table>
  ${d.totals ? `<div class="grid"><div></div><div class="box">${d.totals.map(([k, v, big]) => `<div class="row${big ? ' tot' : ''}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div></div>` : ''}
  ${d.notes ? `<div class="box" style="margin-top:10px"><div class="muted sm">NOTES</div>${esc(d.notes)}</div>` : ''}
  ${d.terms ? `<div class="muted sm" style="margin-top:12px"><b>Terms:</b> ${esc(d.terms)}</div>` : ''}
  ${d.footer ? `<div class="muted sm" style="margin-top:8px">${esc(d.footer)}</div>` : ''}
  </body></html>`
}

function pricedLines(items: Quotation['items'] | SalesOrder['items'], t: ReturnType<typeof docTotals>) {
  return items.map((l, i) => ({ name: l.name, variant: variantLabel(l.size, l.color), qty: l.qty, unit: l.unit, price: l.price, amount: t.items[i]?.lineTotal ?? round2(l.price * l.qty) }))
}

function totalsRows(t: ReturnType<typeof docTotals>, store: Store, label = 'TOTAL'): Array<[string, string, boolean?]> {
  const rows: Array<[string, string, boolean?]> = []
  if (t.itemDiscount + t.billDiscount > 0) rows.push(['Discount', `− ${inr(round2(t.itemDiscount + t.billDiscount))}`])
  rows.push([store.priceIncludesTax ? 'GST included' : 'GST added', inr(t.taxTotal)])
  if (t.roundOff) rows.push(['Round off', inr(t.roundOff)])
  rows.push([label, inr(t.total), true])
  return rows
}

export function quotationHtml(q: Quotation, store: Store, now: number): string {
  const t = docTotals(q.items, q.billDiscountType, q.billDiscountValue, store)
  return renderDocHtml({
    title: 'QUOTATION', no: q.no, date: q.date, store, party: { name: q.partyName, phone: q.partyPhone },
    meta: [['Valid until', fmtDate(q.validUntil)], ['Status', QUOTE_LABEL[q.status === 'draft' || q.status === 'sent' ? (q.validUntil < now - 86_400_000 ? 'expired' : q.status) : q.status]]],
    lines: pricedLines(q.items, t), totals: totalsRows(t, store), notes: q.notes, terms: q.terms,
  })
}

export function orderHtml(o: SalesOrder, store: Store, customer: { name: string; phone?: string; address?: string; gstin?: string }, money: OrderMoney): string {
  const t = docTotals(o.items, o.billDiscountType, o.billDiscountValue, store)
  const rows = totalsRows(t, store, 'ORDER TOTAL')
  rows.push(['Advance received', inr(money.paidIn)], ['Balance to pay', inr(money.toPay), true])
  return renderDocHtml({
    title: 'SALES ORDER', no: o.no, date: o.date, store, party: customer,
    meta: [...(o.expectedDate ? [['Delivery by', fmtDate(o.expectedDate)] as [string, string]] : []), ['Status', ORDER_LABEL[o.status]]],
    lines: pricedLines(o.items, t), totals: rows, notes: o.notes,
    footer: o.instalments?.length ? `Payment plan: ${o.instalments.map((i) => `${inr(i.amount)} by ${fmtDate(i.dueDate)}`).join(' · ')}` : undefined,
  })
}

export function challanHtml(c: Challan, store: Store): string {
  return renderDocHtml({
    title: 'DELIVERY CHALLAN', no: c.no, date: c.date, store, party: { name: c.partyName, phone: c.partyPhone, address: c.address },
    meta: [['Status', CHALLAN_LABEL[c.status]], ...(c.vehicle ? [['Vehicle', c.vehicle] as [string, string]] : []), ...(c.driver ? [['Driver', c.driver] as [string, string]] : []), ...(c.trackingNo ? [['Tracking', c.trackingNo] as [string, string]] : [])],
    lines: c.items.map((l) => ({ name: l.name, variant: l.sku, qty: l.qty, unit: l.unit })), notes: c.notes,
    footer: 'Goods received in good condition. Receiver’s signature: ____________________',
  })
}

export function orderText(o: SalesOrder, store: Pick<StoreSettings, 'name' | 'phone'>, customerName: string, money: OrderMoney): string {
  const lines = [`*${store.name}*`, `Order ${o.no} · ${fmtDate(o.date)}`, `Hi ${customerName.split(' ')[0]},`, '']
  for (const i of o.items) lines.push(`• ${i.name}${variantLabel(i.size, i.color) ? ` (${variantLabel(i.size, i.color)})` : ''} × ${fmtQty(i.qty)}`)
  lines.push('', `*Order total: ${inr(o.total, 0)}*`)
  if (money.paidIn > 0) lines.push(`Advance received: ${inr(money.paidIn, 0)}`)
  lines.push(`Balance: ${inr(money.toPay, 0)}`)
  if (o.expectedDate) lines.push(`Ready by ${fmtDate(o.expectedDate)}`)
  if (store.phone) lines.push(`📞 ${store.phone}`)
  return lines.join('\n')
}

export function challanText(c: Challan, store: Pick<StoreSettings, 'name'>): string {
  const lines = [`*${store.name}*`, `Delivery ${c.no} · ${CHALLAN_LABEL[c.status]}`, '']
  for (const l of c.items) lines.push(`• ${l.name} × ${fmtQty(l.qty)}`)
  if (c.vehicle) lines.push(`Vehicle: ${c.vehicle}${c.driver ? ` (${c.driver})` : ''}`)
  if (c.trackingNo) lines.push(`Tracking: ${c.trackingNo}`)
  return lines.join('\n')
}

export function shiftHtml(shift: Shift, f: ShiftFigures, store: Store, userName: string): string {
  const rows: Array<[string, string, boolean?]> = [
    ['Opening cash', inr(f.opening)], ['Cash sales', inr(f.cashSales)], ['Cash put in', inr(f.payIns)], ['Cash taken out', `− ${inr(f.payOuts)}`], ['Cash expenses', `− ${inr(f.cashExpenses)}`],
    ['Should be in the drawer', inr(f.expected), true],
  ]
  if (shift.status === 'closed') rows.push(['Counted', inr(shift.countedCash ?? 0)], ['Difference', `${(shift.variance ?? 0) > 0 ? '+' : ''}${inr(shift.variance ?? 0)}`, true])
  const moves = f.moves.map((m) => `<tr><td>${esc(fmtDateTime(m.date))}</td><td>${m.kind === 'in' ? 'In' : 'Out'}</td><td>${esc(m.reason)}</td><td class="r">${esc(inr(m.amount))}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <div class="row"><div><h1>${esc(store.name)}</h1><div class="muted">Shift report</div></div><div class="r"><div class="b">${esc(shift.no)}</div><div>${esc(userName)}</div><div class="muted sm">${esc(fmtDateTime(shift.openedAt))}${shift.closedAt ? ` → ${esc(fmtDateTime(shift.closedAt))}` : ' → open'}</div></div></div>
  <div class="grid"><div class="box">${rows.map(([k, v, big]) => `<div class="row${big ? ' tot' : ''}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}<div class="muted sm" style="margin-top:6px">${f.bills} bills</div></div></div>
  ${moves ? `<table><tr><th>When</th><th>Direction</th><th>Reason</th><th class="r">Amount</th></tr>${moves}</table>` : ''}
  </body></html>`
}

export function shiftText(shift: Shift, f: ShiftFigures, storeName: string, userName: string): string {
  const lines = [`*${storeName}* — shift ${shift.no} (${userName})`, `${fmtDateTime(shift.openedAt)}${shift.closedAt ? ` → ${fmtDateTime(shift.closedAt)}` : ' (open)'}`, '',
    `Opening: ${inr(f.opening, 0)}`, `Cash sales: ${inr(f.cashSales, 0)}`, `Cash in: ${inr(f.payIns, 0)}`, `Cash out: ${inr(f.payOuts, 0)}`, `Cash expenses: ${inr(f.cashExpenses, 0)}`, `*Expected: ${inr(f.expected, 0)}*`]
  if (shift.status === 'closed') lines.push(`Counted: ${inr(shift.countedCash ?? 0, 0)}`, `Difference: ${inr(shift.variance ?? 0, 0)}`)
  return lines.join('\n')
}
