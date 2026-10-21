import { fmtDate } from '@/domain/dates'
import { amountInWords, inr } from '@/domain/money'
import { esc } from '@/domain/receipt'
import type { StoreSettings } from '@/domain/types'
import type { HrTable } from './logic/reports'
import { labelYM } from './logic/ymd'
import type { Employee, EmployeePay, Payslip } from './types'

type Store = Pick<StoreSettings, 'name' | 'tagline' | 'address' | 'city' | 'phone' | 'gstin'>

const CSS = `*{box-sizing:border-box}body{margin:0;padding:24px;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;font-size:12px;line-height:1.4}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:0 0 6px}.muted{color:#555}.sm{font-size:11px}.r{text-align:right}.b{font-weight:700}.row{display:flex;justify-content:space-between;gap:12px}
.box{border:1px solid #bbb;border-radius:4px;padding:8px 10px}.grid{display:flex;gap:12px;margin:12px 0}.grid>div{flex:1}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px 6px;vertical-align:top}th{background:#f2f2f2;text-align:left;font-size:11px}
.net{font-size:16px;font-weight:800}@page{size:A4;margin:14mm}`

const mask = (acc: string) => (acc.length > 4 ? `XXXX${acc.slice(-4)}` : acc)

/** A payslip on A4. Bank and PAN are printed in part only; the page says plainly that it is computer generated. */
export function payslipHtml(slip: Payslip, store: Store, employee: Pick<Employee, 'joinDate' | 'department'> | undefined, pay: Pick<EmployeePay, 'bank' | 'pan' | 'uan' | 'esiNo'> | undefined): string {
  const lines = (list: Payslip['earnings']) => list.map((l) => `<tr><td>${esc(l.label)}${l.full !== undefined && l.full !== l.amount ? `<div class="muted sm">of ${esc(inr(l.full))} for the full month</div>` : ''}</td><td class="r">${esc(inr(l.amount))}</td></tr>`).join('')
  const pad = Math.max(slip.earnings.length, slip.deductions.length)
  const filler = (n: number) => '<tr><td>&nbsp;</td><td></td></tr>'.repeat(Math.max(0, pad - n))
  const info = (k: string, v: string) => (v ? `<div><span class="muted">${esc(k)}:</span> ${esc(v)}</div>` : '')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>
  <div class="row"><div><h1>${esc(store.name)}</h1><div class="muted">${esc([store.address, store.city].filter(Boolean).join(', '))}</div>${store.phone ? `<div>Ph: ${esc(store.phone)}</div>` : ''}</div>
    <div class="r"><div style="font-size:18px;font-weight:800;letter-spacing:1px">PAYSLIP</div><div>${esc(labelYM(slip.month))}</div><div class="muted sm">No. ${esc(slip.no)}</div></div></div>
  <div class="grid"><div class="box"><h2>${esc(slip.employeeName)}</h2>${info('Employee code', slip.employeeCode)}${info('Designation', slip.designation)}${info('Department', employee?.department ?? '')}${info('Joined', employee?.joinDate ? fmtDate(new Date(`${employee.joinDate}T12:00:00`).getTime()) : '')}</div>
    <div class="box">${info('Bank account', pay?.bank.account ? `${mask(pay.bank.account)}${pay.bank.bankName ? ` (${pay.bank.bankName})` : ''}` : '')}${info('PAN', pay?.pan ? `XXXXXX${pay.pan.slice(-4)}` : '')}${info('UAN', pay?.uan ?? '')}${info('ESI no.', pay?.esiNo ?? '')}</div>
    <div class="box">${info('Days in month', String(slip.daysInMonth))}${info('Days worked', String(slip.presentDays))}${slip.paidLeaveDays ? info('Paid leave', String(slip.paidLeaveDays)) : ''}${info('Loss of pay days', String(slip.lopDays))}${slip.overtimeHours ? info('Overtime hours', String(slip.overtimeHours)) : ''}</div></div>
  <div class="grid"><div><table><tr><th>Earnings</th><th class="r">Amount</th></tr>${lines(slip.earnings)}${filler(slip.earnings.length)}<tr><td class="b">Gross pay</td><td class="r b">${esc(inr(slip.gross))}</td></tr></table></div>
    <div><table><tr><th>Deductions</th><th class="r">Amount</th></tr>${slip.deductions.length ? lines(slip.deductions) : '<tr><td class="muted">None</td><td></td></tr>'}${filler(Math.max(slip.deductions.length, 1))}<tr><td class="b">Total deductions</td><td class="r b">${esc(inr(slip.totalDeductions))}</td></tr></table></div></div>
  <div class="box"><div class="row net"><span>Net pay</span><span>${esc(inr(slip.net))}</span></div>${slip.roundOff ? `<div class="muted sm">Rounded by ${esc(inr(slip.roundOff))}</div>` : ''}<div class="sm">${esc(amountInWords(slip.net))}</div></div>
  ${slip.employerPf || slip.employerEsi ? `<div class="muted sm" style="margin-top:8px">Employer’s contribution (not deducted from you): PF ${esc(inr(slip.employerPf))}${slip.employerEsi ? `, ESI ${esc(inr(slip.employerEsi))}` : ''}</div>` : ''}
  <div class="muted sm" style="margin-top:14px">This is a computer-generated payslip and needs no signature.</div></body></html>`
}

/** A report as a printable page. */
export function tableHtml(storeName: string, t: HrTable): string {
  const bold = new Set(t.bold ?? [])
  const cell = (v: unknown) => (typeof v === 'number' ? inr(v, Number.isInteger(v) ? 0 : 2) : esc(v === null || v === undefined ? '' : String(v)))
  const head = t.columns.map((c) => `<th${c.align === 'right' ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('')
  const body = t.rows.map((r, i) => `<tr${bold.has(i) ? ' class="b"' : ''}>${r.map((v, k) => `<td${t.columns[k]?.align === 'right' ? ' class="r"' : ''}>${typeof v === 'number' && t.columns[k]?.align === 'right' ? esc(String(v)) : cell(v)}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>
  <h1>${esc(storeName)}</h1><h2 style="margin-top:4px">${esc(t.title)}</h2>${t.subtitle ? `<div class="muted sm">${esc(t.subtitle)}</div>` : ''}
  <table style="margin-top:10px"><tr>${head}</tr>${body}</table></body></html>`
}
