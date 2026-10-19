import type { DayCloseFigures } from './analytics'
import { fmtDateTime, fmtLongDate } from './dates'
import { inr, round2 } from './money'
import { esc } from './receipt'
import type { DaySession, StoreSettings } from './types'

/** Everything a Z-report needs to be printed or sent: the business, the drawer session and its frozen figures. */
export interface DayCloseDoc {
  store: Pick<StoreSettings, 'name' | 'address' | 'city' | 'phone' | 'gstin'>
  session: DaySession
  figures: DayCloseFigures
  openedBy?: string
  closedBy?: string
}

export type VarianceKind = 'none' | 'short' | 'over' | 'balanced'

/** Counted minus expected: negative = cash missing from the drawer, positive = more than the books say. */
export function varianceKind(variance: number | undefined): VarianceKind {
  if (variance === undefined || !Number.isFinite(variance)) return 'none'
  const v = round2(variance)
  return v === 0 ? 'balanced' : v < 0 ? 'short' : 'over'
}

export function varianceLabel(variance: number | undefined): string {
  const v = round2(variance ?? 0)
  switch (varianceKind(variance)) {
    case 'short': return `Short by ${inr(Math.abs(v))}`
    case 'over': return `Over by ${inr(v)}`
    case 'balanced': return 'Cash matches'
    default: return 'Not counted yet'
  }
}

/** The drawer arithmetic, laid out as the lines a person would check against the till. */
function lines(f: DayCloseFigures): Array<[string, string]> {
  return [
    ['Opening cash', inr(f.opening)],
    ['+ Cash received', inr(f.cashIn)],
    ['− Cash expenses', inr(f.cashExpenses)],
  ]
}

const counted = (s: DaySession) => (s.countedCash === undefined ? undefined : round2(s.countedCash))

/** The Z-report as plain text — for WhatsApp or the share sheet. */
export function dayCloseText(doc: DayCloseDoc): string {
  const { store, session, figures: f } = doc
  const closed = !!session.closedAt
  const expected = closed ? session.expectedCash ?? f.expected : f.expected
  const out = [
    `*${store.name}* — ${closed ? 'Day close' : 'Day so far'}`,
    fmtLongDate(session.closedAt ?? session.openedAt),
    `Opened ${fmtDateTime(session.openedAt)}${doc.openedBy ? ` by ${doc.openedBy}` : ''}`,
    ...(closed ? [`Closed ${fmtDateTime(session.closedAt!)}${doc.closedBy ? ` by ${doc.closedBy}` : ''}`] : []),
    '',
    `Sales: ${inr(f.totalSales)} (${f.bills} ${f.bills === 1 ? 'bill' : 'bills'})`,
    `UPI + card: ${inr(f.digital)}`,
    '',
    ...lines(f).map(([k, v]) => `${k}: ${v}`),
    `Expected in drawer: ${inr(expected)}`,
  ]
  const c = counted(session)
  if (c !== undefined) out.push(`Counted: ${inr(c)}`, varianceLabel(session.variance))
  if (session.note) out.push('', session.note)
  return out.join('\n')
}

/** The Z-report as a narrow, thermal-printer-friendly page (also fine on A4). */
export function dayCloseHtml(doc: DayCloseDoc): string {
  const { store, session, figures: f } = doc
  const closed = !!session.closedAt
  const expected = closed ? session.expectedCash ?? f.expected : f.expected
  const c = counted(session)
  const row = (k: string, v: string, cls = '') => `<div class="row ${cls}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`
  const body = `
  <h1>${esc(store.name)}</h1>
  <div class="c muted sm">${esc([store.address, store.city].filter(Boolean).join(', '))}</div>
  ${store.phone ? `<div class="c muted sm">Ph: ${esc(store.phone)}</div>` : ''}${store.gstin ? `<div class="c muted sm">GSTIN: ${esc(store.gstin)}</div>` : ''}
  <h2>${closed ? 'DAY CLOSE · Z-REPORT' : 'DAY SO FAR · X-REPORT'}</h2>
  <div class="c muted sm">${esc(fmtLongDate(session.closedAt ?? session.openedAt))}</div>
  <hr>
  ${row('Opened', fmtDateTime(session.openedAt) + (doc.openedBy ? ` · ${doc.openedBy}` : ''), 'sm')}
  ${closed ? row('Closed', fmtDateTime(session.closedAt!) + (doc.closedBy ? ` · ${doc.closedBy}` : ''), 'sm') : ''}
  <hr>
  <div class="b">Sales</div>
  ${row('Bills', String(f.bills))}
  ${row('Total sales', inr(f.totalSales), 'b')}
  ${row('UPI + card', inr(f.digital))}
  <hr>
  <div class="b">Cash drawer</div>
  ${lines(f).map(([k, v]) => row(k, v)).join('')}
  ${row('Expected in drawer', inr(expected), 'tot')}
  ${c !== undefined ? `${row('Counted', inr(c), 'b')}${row(varianceLabel(session.variance), inr(Math.abs(round2(session.variance ?? 0))), 'b')}` : '<div class="muted sm">Cash not counted yet.</div>'}
  ${session.note ? `<hr><div class="sm">${esc(session.note)}</div>` : ''}
  <div style="height:36px"></div>
  <div class="row sm muted"><span>Cashier signature</span><span>Owner signature</span></div>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box}body{margin:0;padding:12px;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;font-size:12px;line-height:1.4;width:100%;max-width:380px;margin-inline:auto}
  h1{font-size:16px;margin:0;text-align:center}h2{font-size:13px;margin:10px 0 2px;text-align:center;letter-spacing:.5px}
  .c{text-align:center}.muted{color:#555}.b{font-weight:700}.sm{font-size:11px}
  hr{border:0;border-top:1px dashed #999;margin:8px 0}
  .row{display:flex;justify-content:space-between;gap:8px;padding:1px 0}.tot{font-size:15px;font-weight:800;border-top:1px solid #999;margin-top:4px;padding-top:4px}
</style></head><body>${body}</body></html>`
}
