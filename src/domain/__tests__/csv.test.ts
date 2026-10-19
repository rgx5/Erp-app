import { csvCell, csvFileName, toCsv } from '../csv'
import { reportRows } from '../reportCsv'
import { computeReport } from '../analytics'
import type { ReportAgg } from '../analytics'

describe('csv', () => {
  it('leaves plain values alone and renders numbers and blanks', () => {
    expect(csvCell('Oxford Shirt')).toBe('Oxford Shirt')
    expect(csvCell(1234.5)).toBe('1234.5')
    expect(csvCell(-20)).toBe('-20')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(Number.NaN)).toBe('')
    expect(csvCell(true)).toBe('Yes')
  })

  it('quotes commas, quotes and line breaks, doubling inner quotes (RFC 4180)', () => {
    expect(csvCell('Shirt, blue')).toBe('"Shirt, blue"')
    expect(csvCell('6" ruler')).toBe('"6"" ruler"')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"')
  })

  it('defuses spreadsheet formulas but keeps negative numbers in text form', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(csvCell('+91 98765')).toBe("'+91 98765")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell('-cmd|x')).toBe("'-cmd|x")
    expect(csvCell('-1,200.50')).toBe('"-1,200.50"')
    expect(csvCell('-15')).toBe('-15')
  })

  it('joins rows with CRLF and ends with one', () => {
    expect(toCsv([['a', 'b'], [1, 'c,d']])).toBe('a,b\r\n1,"c,d"\r\n')
    expect(toCsv([])).toBe('')
    expect(toCsv([['x'], [], ['y']])).toBe('x\r\n\r\ny\r\n')
  })

  it('makes a safe file name', () => {
    expect(csvFileName('Sales 01 Oct – 19 Oct')).toBe('sales-01-oct-19-oct.csv')
    expect(csvFileName('!!!')).toBe('report.csv')
    expect(csvFileName('GST', 'json')).toBe('gst.json')
  })
})

describe('report rows', () => {
  const empty: ReportAgg = computeReport({ bills: [], expenses: [], variants: [], products: [], store: null }, [], 0, 1)
  it('builds every section from an empty period without throwing and with a header row', () => {
    for (const s of ['sales', 'gst', 'profit', 'items', 'staff'] as const) {
      const rows = reportRows(s, empty, { profit: true, itemLabel: 'Item', staffLabel: 'Salesperson' })
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0].length).toBeGreaterThan(1)
      expect(toCsv(rows)).toContain('\r\n')
    }
  })

  it('hides cost columns from people who may not see profit', () => {
    const r: ReportAgg = { ...empty, items: [{ id: 'v1', name: 'Shirt', sku: 'SH-1', variant: 'M', qty: 2, revenue: 1000, cost: 600 }] }
    const hidden = reportRows('items', r, { profit: false, itemLabel: 'Item', staffLabel: 'Staff' })
    const shown = reportRows('items', r, { profit: true, itemLabel: 'Item', staffLabel: 'Staff' })
    expect(hidden[0]).toEqual(['Item', 'Code', 'Option', 'Quantity', 'Sales before GST (₹)'])
    expect(shown[1]).toEqual(['Shirt', 'SH-1', 'M', 2, 1000, 600, 400, 40])
  })
})
