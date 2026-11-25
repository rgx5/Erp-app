import type { Payslip } from '@/api/schemas'
import { formatDate, formatInr } from '@/domain/format'
import { DOC_CSS } from '@/features/sales/invoiceHtml'

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** One payslip as a self-contained A4 page (no scripts). Amounts are the server's, only formatted. */
export function payslipHtml(p: Payslip, company: string, payDate: string): string {
  const amt = (v: string): string => formatInr(v, { symbol: false })
  const earn = (p.detail.earnings ?? []).map((e) => `<tr><td>${esc(e.name)}</td><td>${amt(e.amount)}</td></tr>`).join('')
  const bonus = Number(p.detail.bonus ?? 0) ? `<tr><td>Bonus</td><td>${amt(p.detail.bonus ?? '0')}</td></tr>` : ''
  const ded = ([['Provident fund', p.pfEmployee], ['ESI', p.esiEmployee], ['Professional tax', p.professionalTax], ['Income tax (TDS)', p.tds], ['Other deductions', p.otherDeductions]] as [string, string][])
    .filter(([, v]) => Number(v) !== 0).map(([k, v]) => `<tr><td>${k}</td><td>${amt(v)}</td></tr>`).join('')
  const section = (title: string, body: string): string => `<div class="label" style="margin-top:18px">${title}</div><table class="items" style="margin-top:4px"><tbody>${body}</tbody></table>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(p.employeeNo)} ${esc(p.period)}</title><style>${DOC_CSS} table.items td:nth-child(1){width:auto;color:inherit;padding-left:0} table.items td:last-child{width:130px}</style></head><body>
<div class="head"><div class="seller"><div class="name">${esc(company)}</div><div class="muted">Pay period ${esc(p.period)}</div></div>
  <div class="title"><div class="kind">Payslip</div><dl class="meta" style="margin-top:6px"><dt>Paid on</dt><dd>${esc(formatDate(payDate))}</dd>${p.detail.paidDays ? `<dt>Paid days</dt><dd>${esc(p.detail.paidDays)}</dd>` : ''}</dl></div></div>
<div class="parties" style="grid-template-columns:1fr"><div><div class="label">Employee</div><div class="strong">${esc(p.employeeName)}</div><div class="muted">${esc(p.employeeNo)}</div></div></div>
${section('Earnings', `${earn}${bonus}<tr><td class="strong">Gross</td><td class="strong">${amt(p.gross)}</td></tr>`)}
${section('Deductions', ded || '<tr><td class="muted">None</td><td></td></tr>')}
<div class="summary"><div class="words"></div><div class="totals"><div class="grand"><span>Net pay</span><span class="num">${formatInr(p.net)}</span></div></div></div>
<div class="fine">System-generated. Employer contributions are not part of the pay shown.</div></body></html>`
}
