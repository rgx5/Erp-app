import { useQueries } from '@tanstack/react-query'
import { formatInr } from '@/domain/format'
import { download, toCsv } from '@/features/masterdata/csv'
import { Alert, Button, Card, Spinner } from '@/ui/primitives'
import { fetchGstr3b } from './queries'

/** April of the financial year to the March after it, as YYYY-MM. */
export const monthsOfYear = (fy: string): string[] => { const y = Number(fy.slice(0, 4)); return Array.from({ length: 12 }, (_, i) => { const m = ((i + 3) % 12) + 1; return `${m >= 4 ? y : y + 1}-${String(m).padStart(2, '0')}` }) }
type Amounts = { txval?: string; iamt?: string; camt?: string; samt?: string; csamt?: string }
const n = (v: string | undefined): number => Number(v ?? 0)
const sum = (xs: (Amounts | undefined)[]): { txval: number; igst: number; cgst: number; sgst: number; cess: number } => xs.reduce((t, x) => ({ txval: t.txval + n(x?.txval), igst: t.igst + n(x?.iamt), cgst: t.cgst + n(x?.camt), sgst: t.sgst + n(x?.samt), cess: t.cess + n(x?.csamt) }), { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 })
const f = (v: number): string => formatInr(String(Math.round(v * 100) / 100), { symbol: false })

/** The annual return worked out from the twelve monthly GSTR-3B figures of the year. A cross-check for the portal's GSTR-9, which is built from what was actually filed. */
export function Gstr9View({ registrationId, fy }: { registrationId: string; fy: string }) {
  const months = monthsOfYear(fy)
  const qs = useQueries({ queries: months.map((m) => ({ queryKey: ['gst', 'gstr3b', registrationId, m], queryFn: () => fetchGstr3b(registrationId, m), retry: false })) })
  if (qs.some((q) => q.isPending)) return <Spinner />
  const bad = qs.find((q) => q.error)
  if (bad) return <Alert>{(bad.error as Error).message}</Alert>
  const r = qs.map((q) => q.data!)
  const out = sum(r.map((x) => x.sup_details.osup_det)); const zero = sum(r.map((x) => x.sup_details.osup_zero)); const rev = sum(r.map((x) => x.sup_details.isup_rev))
  const nil = r.reduce((t, x) => t + n(x.sup_details.osup_nil_exmp.txval), 0); const nong = r.reduce((t, x) => t + n(x.sup_details.osup_nongst.txval), 0)
  const itc = { net: sum(r.map((x) => x.itc_elg.itc_net)), rev: sum(r.map((x) => x.itc_elg.itc_rev.oth)), blocked: sum(r.map((x) => x.itc_elg.itc_inelg.oth)), avl: sum(r.map((x) => x.itc_elg.itc_avl.oth)), imp: sum(r.map((x) => x.itc_elg.itc_avl.impg_and_imps)), rc: sum(r.map((x) => x.itc_elg.itc_avl.isrc)) }
  const tax = (pick: (x: (typeof r)[number]) => { igst: string; cgst: string; sgst: string; cess: string }) => r.reduce((t, x) => { const p = pick(x); return { igst: t.igst + n(p.igst), cgst: t.cgst + n(p.cgst), sgst: t.sgst + n(p.sgst), cess: t.cess + n(p.cess) } }, { igst: 0, cgst: 0, sgst: 0, cess: 0 })
  const liab = tax((x) => x.tax_pmt.liability); const viaItc = tax((x) => x.tax_pmt.paid_through_itc); const cash = tax((x) => x.tax_pmt.payable_in_cash)
  const rows: [string, string, string, string, string, string][] = [
    ['Part II · Outward and inward supplies', '', '', '', '', ''],
    ['4  Taxable outward supplies (regular)', f(out.txval), f(out.igst), f(out.cgst), f(out.sgst), f(out.cess)],
    ['5  Zero-rated: exports and SEZ', f(zero.txval), f(zero.igst), f(zero.cgst), f(zero.sgst), f(zero.cess)],
    ['5  Nil-rated and exempt supplies', f(nil), '', '', '', ''], ['5  Non-GST outward supplies', f(nong), '', '', '', ''],
    ['4  Inward supplies on reverse charge', f(rev.txval), f(rev.igst), f(rev.cgst), f(rev.sgst), f(rev.cess)],
    ['Part III · Input tax credit', '', '', '', '', ''],
    ['6  ITC on imports', '', f(itc.imp.igst), f(itc.imp.cgst), f(itc.imp.sgst), f(itc.imp.cess)], ['6  ITC on reverse charge', '', f(itc.rc.igst), f(itc.rc.cgst), f(itc.rc.sgst), f(itc.rc.cess)],
    ['6  ITC on other supplies', '', f(itc.avl.igst), f(itc.avl.cgst), f(itc.avl.sgst), f(itc.avl.cess)],
    ['7  ITC reversed', '', f(itc.rev.igst), f(itc.rev.cgst), f(itc.rev.sgst), f(itc.rev.cess)], ['8  Ineligible (blocked) ITC', '', f(itc.blocked.igst), f(itc.blocked.cgst), f(itc.blocked.sgst), f(itc.blocked.cess)],
    ['  Net ITC availed', '', f(itc.net.igst), f(itc.net.cgst), f(itc.net.sgst), f(itc.net.cess)],
    ['Part IV · Tax paid', '', '', '', '', ''],
    ['9  Tax payable', '', f(liab.igst), f(liab.cgst), f(liab.sgst), f(liab.cess)], ['9  Paid through input credit', '', f(viaItc.igst), f(viaItc.cgst), f(viaItc.sgst), f(viaItc.cess)], ['9  Paid in cash', '', f(cash.igst), f(cash.cgst), f(cash.sgst), f(cash.cess)],
  ]
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Annual working, {fy}</h2><Button variant="secondary" onClick={() => download(`gstr9-working-${fy}.csv`, toCsv(['Item', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess'], rows.map((x) => [...x])))}>Download CSV</Button></div>
      <Alert tone="info">Added up from the twelve monthly GSTR-3B figures in the books. Compare with the portal's GSTR-9, which is prepared from what you actually filed; differences are late or amended entries. This is a working, not the return.</Alert>
      <table className="mt-3 w-full text-sm" aria-label="GSTR-9 working"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="num py-1 text-right">Taxable</th><th className="num py-1 text-right">IGST</th><th className="num py-1 text-right">CGST</th><th className="num py-1 text-right">SGST</th><th className="num py-1 text-right">Cess</th></tr></thead>
        <tbody>{rows.map((x, i) => x[1] === '' && x[2] === '' ? <tr key={i} className="border-t border-line"><td colSpan={6} className="pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{x[0]}</td></tr> : <tr key={i} className="border-t border-line/60"><td className="py-1.5">{x[0]}</td>{x.slice(1).map((c, k) => <td key={k} className="num py-1.5 text-right">{c}</td>)}</tr>)}</tbody></table>
    </Card>
  )
}
