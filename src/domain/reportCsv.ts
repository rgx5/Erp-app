import type { ReportAgg } from './analytics'
import { fmtDate } from './dates'
import { round2 } from './money'
import type { CsvCell } from './csv'

export type ReportSection = 'sales' | 'gst' | 'profit' | 'items' | 'staff'

export const SECTION_LABEL: Record<ReportSection, string> = { sales: 'Sales', gst: 'GST', profit: 'Profit', items: 'Items', staff: 'Staff' }

const margin = (revenue: number, cost: number) => (revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : 0)

/** The rows behind one report section, ready for `toCsv`. Mirrors what the screen shows, figure for figure. */
export function reportRows(section: ReportSection, r: ReportAgg, o: { profit: boolean; itemLabel: string; staffLabel: string }): CsvCell[][] {
  switch (section) {
    case 'sales':
      return [
        ['Date', 'Bills', 'Pieces', 'Sales (₹)'],
        ...r.daily.map((d) => [fmtDate(d.start), d.bills, d.qty, d.total] as CsvCell[]),
        [],
        ['Payment mode', 'Amount (₹)'],
        ...r.modes.map(([m, v]) => [m, v] as CsvCell[]),
        [],
        ['Total sales (₹)', r.revenue], ['Sales before GST (₹)', r.net], ['GST collected (₹)', r.gst], ['Discounts (₹)', r.discount],
        ['Bills', r.positive], ['Returns', r.credits], ['Returned value (₹)', r.creditTotal],
      ]
    case 'gst':
      return [
        ['HSN', 'GST %', 'Quantity', 'Taxable value (₹)', 'CGST (₹)', 'SGST (₹)', 'Total tax (₹)'],
        ...r.hsn.map((h) => [h.hsn, h.rate, h.qty, h.taxable, h.cgst, h.sgst, round2(h.cgst + h.sgst)] as CsvCell[]),
        [],
        ['GST %', 'Taxable value (₹)', 'CGST (₹)', 'SGST (₹)', 'Total tax (₹)'],
        ...r.rates.map((x) => [x.rate, x.taxable, x.cgst, x.sgst, round2(x.cgst + x.sgst)] as CsvCell[]),
        [],
        ['Total taxable (₹)', r.net], ['Total GST collected (₹)', r.gst], ['GST paid to government (₹)', r.gstPaid],
      ]
    case 'profit':
      return [
        ['Line', 'Amount (₹)'],
        ['Sales before GST', r.net], ['Cost of goods', r.cogs], ['Gross profit', r.grossProfit], ['Expenses', r.expenses], ['Net profit', r.netProfit],
        [],
        ['Expense category', 'Amount (₹)'],
        ...r.expenseByCategory.map(([k, v]) => [k, v] as CsvCell[]),
      ]
    case 'items':
      return [
        [o.itemLabel, 'Code', 'Option', 'Quantity', 'Sales before GST (₹)', ...(o.profit ? ['Cost (₹)', 'Profit (₹)', 'Margin %'] : [])],
        ...r.items.map((i) => [i.name, i.sku, i.variant, i.qty, i.revenue, ...(o.profit ? [i.cost, round2(i.revenue - i.cost), margin(i.revenue, i.cost)] : [])] as CsvCell[]),
      ]
    case 'staff':
      return [
        [o.staffLabel, 'Bills', 'Quantity', 'Sales (₹)', 'Discount given (₹)'],
        ...r.staff.map((s) => [s.user?.name ?? 'Former staff', s.bills, s.qty, s.revenue, s.discount] as CsvCell[]),
      ]
  }
}
