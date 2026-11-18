import type { Payslip } from '@/api/schemas'
import { formatDate, formatInr } from '@/domain/format'

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** One payslip as a self-contained A4 page (no scripts). Amounts are the server's, only formatted. */
export function payslipHtml(p: Payslip, company: string, payDate: string): string {
  const amt = (v: string): string => formatInr(v, { symbol: false })
  const earn = (p.detail.earnings ?? []).map((e) => `<tr><td>${esc(e.name)}</td><td class="r">${amt(e.amount)}</td></tr>`).join('')
  const bonus = Number(p.detail.bonus ?? 0) ? `<tr><td>Bonus</td><td class="r">${amt(p.detail.bonus ?? '0')}</td></tr>` : ''
  const ded = ([['Provident fund', p.pfEmployee], ['ESI', p.esiEmployee], ['Professional tax', p.professionalTax], ['Income tax (TDS)', p.tds], ['Other deductions', p.otherDeductions]] as [string, string][])
    .filter(([, v]) => Number(v) !== 0).map(([k, v]) => `<tr><td>${k}</td><td class="r">${amt(v)}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(p.employeeNo)} ${esc(p.period)}</title>
<style>@page{size:A4;margin:16mm}body{font:12px/1.4 system-ui,sans-serif;color:#111}h1{font-size:16px;margin:0}table{width:100%;border-collapse:collapse;margin-top:8px}td{padding:3px 0}.r{text-align:right}.tot td{border-top:1px solid #111;font-weight:600}.muted{color:#555}</style></head><body>
<h1>${esc(company)}</h1><div class="muted">Payslip for ${esc(p.period)} · paid ${esc(formatDate(payDate))}</div>
<p><b>${esc(p.employeeName)}</b> (${esc(p.employeeNo)})${p.detail.paidDays ? `<br><span class="muted">Paid days ${esc(p.detail.paidDays)}</span>` : ''}</p>
<table><tr><td colspan="2"><b>Earnings</b></td></tr>${earn}${bonus}<tr class="tot"><td>Gross</td><td class="r">${amt(p.gross)}</td></tr></table>
<table><tr><td colspan="2"><b>Deductions</b></td></tr>${ded || '<tr><td class="muted">None</td><td></td></tr>'}</table>
<table><tr class="tot"><td>Net pay</td><td class="r">${amt(p.net)}</td></tr></table>
<p class="muted">System-generated. Employer contributions are not part of the pay shown.</p></body></html>`
}
