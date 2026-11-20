import { formatDate, formatInr } from '@/domain/format'
import { getPaper, paperCss } from '@/features/pos/paper'
import type { DayEndReport } from './queries'

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' }

/** The day-end summary as an 80 mm slip, so it prints on the same roll printer as receipts. */
export function dayEndHtml(d: DayEndReport, shop: string): string {
  const a = (v: string): string => formatInr(v, { symbol: false })
  const row = (k: string, v: string): string => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Day-end ${esc(d.date)}</title>
<style>${paperCss(getPaper())}h1{font-size:13px;margin:0;text-align:center}.c{text-align:center}.r{text-align:right}table{width:100%;border-collapse:collapse}hr{border:0;border-top:1px dashed #000;margin:5px 0}.b{font-weight:700}</style></head><body>
<h1>${esc(shop)}</h1><div class="c b">Day-end report</div><div class="c">${esc(formatDate(d.date))}</div><hr>
<table>${row('Bills', String(d.sales.bills))}${row('Sales (before tax)', a(d.sales.net))}${row('Tax', a(d.sales.tax))}${row('Sales total', a(d.sales.total))}${row(`Returns (${d.returns.bills})`, a(d.returns.total))}<tr class="b"><td>Net sales</td><td class="r">${a(d.netSales)}</td></tr></table><hr>
<div class="b">Takings by mode</div><table>${d.byPaymentMode.map((p) => row(METHOD[p.method] ?? p.method, a(p.amount))).join('')}</table><hr>
<div class="b">Shifts</div>${d.shifts.map((s) => `<table>${row(`${s.shiftNo} ${s.terminal}`, s.status)}${row('Opening', a(s.openingCash))}${s.expectedCash ? row('Expected', a(s.expectedCash)) : ''}${s.countedCash ? row('Counted', a(s.countedCash)) : ''}${s.variance ? row('Over / short', a(s.variance)) : ''}</table>`).join('<hr>') || '<div>No shifts</div>'}
<hr><div class="c">Signed: ____________</div></body></html>`
}
