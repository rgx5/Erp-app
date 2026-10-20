import { baseState, commit, ctx, DAY, NOW, trading } from './helpers'
import { createVoucher } from '../ops'
import { balanceSheet, buildLedger, cashBook, dayBook, partyLedger, profitAndLoss, trialBalance } from '../ledger'
import { tallyGroup, tallyMastersXml, tallyVouchers, tallyVouchersCsv, tallyVouchersXml } from '../tally'
import { accountLedgerTable, balanceSheetTable, dayBookTable, partyLedgerTable, profitAndLossTable, tableHtml, toCsvRows, trialBalanceTable } from '../report-html'
import { toCsv } from '@/domain/csv'

const range = { from: NOW - 30 * DAY, to: NOW + DAY }

describe('Tally export', () => {
  const s = trading()

  test('every voucher nets to zero and every ledger it names is a master', () => {
    const vs = tallyVouchers(s, range)
    expect(vs.length).toBeGreaterThan(8)
    for (const v of vs) expect(Math.abs(Math.round(v.lines.reduce((t, l) => t + l.amount, 0) * 100))).toBe(0)
    const masters = tallyMastersXml(s, 'Test Store')
    const names = [...masters.xml.matchAll(/<LEDGER NAME="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
    for (const v of vs) for (const l of v.lines) expect(names).toContain(l.name)
    expect(masters.ledgers).toBe(names.length)
    expect(names).toEqual(expect.arrayContaining(['Cash in hand', 'Meera', 'Fab Mills', 'Rent']))
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length)
  })

  test('the XML is well formed, signed the way Tally reads it, and escaped', () => {
    const x = commit(s, createVoucher(s, { type: 'journal', date: NOW, narration: 'Fish & <chips> "5%"', lines: [{ account: 'cash', debit: 12.5 }, { account: 'owner_capital', credit: 12.5 }] }, ctx()))
    const { xml, vouchers } = tallyVouchersXml(x, { company: 'A & B <Traders>', ...range })
    expect(vouchers).toBe(tallyVouchers(x, range).length)
    expect(xml).toContain('<SVCURRENTCOMPANY>A &amp; B &lt;Traders&gt;</SVCURRENTCOMPANY>')
    expect(xml).toContain('Fish &amp; &lt;chips&gt; &quot;5%&quot;')
    expect(xml).toContain('<VOUCHERNUMBER>JV-0001</VOUCHERNUMBER>')
    // Debit of 12.50 to cash: deemed positive, negative amount. Credit: the reverse.
    expect(xml).toMatch(/<LEDGERNAME>Cash in hand<\/LEDGERNAME><ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><AMOUNT>-12.50<\/AMOUNT>/)
    expect(xml).toMatch(/<LEDGERNAME>Owner’s capital<\/LEDGERNAME><ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE><AMOUNT>12.50<\/AMOUNT>/)
    expect(xml.match(/<VOUCHER /g)!.length).toBe(vouchers)
    expect(xml.match(/<\/VOUCHER>/g)!.length).toBe(vouchers)
    expect(xml).toContain('VCHTYPE="Sales"')
    expect(xml).toContain('VCHTYPE="Credit Note"')
    expect(xml).toContain('VCHTYPE="Purchase"')
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/)
  })

  test('only the period asked for is exported', () => {
    expect(tallyVouchers(s, { from: NOW + 5 * DAY, to: NOW + 6 * DAY })).toEqual([])
    expect(tallyVouchersXml(s, { company: 'X', from: NOW + 5 * DAY, to: NOW + 6 * DAY }).vouchers).toBe(0)
  })

  test('CSV has a row per ledger line, debits and credits in balance', () => {
    const { csv, vouchers } = tallyVouchersCsv(s, range)
    const rows = csv.trim().split('\r\n')
    expect(rows[0]).toBe('Date,Voucher type,Voucher no,Narration,Ledger,Debit,Credit')
    expect(rows.length - 1).toBe(tallyVouchers(s, range).reduce((t, v) => t + v.lines.length, 0))
    expect(vouchers).toBeGreaterThan(0)
    const dr = rows.slice(1).reduce((t, r) => t + (Number(r.match(/,([\d.]*),([\d.]*)$/)![1]) || 0), 0)
    const cr = rows.slice(1).reduce((t, r) => t + (Number(r.match(/,([\d.]*),([\d.]*)$/)![2]) || 0), 0)
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100))
  })

  test('groups map onto Tally’s', () => {
    const l = buildLedger(baseState())
    const g = (key: string) => tallyGroup(l.chart.find((a) => a.key === key)!)
    expect(g('cash')).toBe('Cash-in-Hand')
    expect(g('gst_output_cgst')).toBe('Duties & Taxes')
    expect(g('sales')).toBe('Sales Accounts')
    expect(g('suspense')).toBe('Suspense A/c')
    expect(tallyGroup({ ...l.chart[0], key: 'expense:Rent', type: 'expense' })).toBe('Indirect Expenses')
    expect(tallyGroup({ ...l.chart[0], key: undefined, type: 'income' })).toBe('Indirect Incomes')
  })
})

describe('statements as tables', () => {
  const s = trading()
  const l = buildLedger(s)

  test('trial balance and balance sheet tables total up', () => {
    const tb = trialBalanceTable(trialBalance(l))
    const total = tb.rows[tb.rows.length - 1]
    expect(total[2]).toBe(total[3])
    const bs = balanceSheetTable(balanceSheet(l))
    const get = (label: string) => bs.rows.find((r) => r[0] === label)![1]
    expect(get('Total assets')).toBe(get('Liabilities + equity'))
  })

  test('profit & loss, ledgers and day book render; CSV and HTML are safe', () => {
    const pl = profitAndLossTable(profitAndLoss(l))
    expect(pl.rows.map((r) => r[0])).toEqual(expect.arrayContaining(['Total income', 'Gross profit', 'Net profit']))
    const cb = accountLedgerTable(cashBook(l)!)
    expect(cb.rows[0][1]).toBe('Opening balance')
    const pt = partyLedgerTable(partyLedger(l, s, 'customer', 'c1'), 'Meera')
    expect(pt.subtitle).toContain('Owes us')
    const db = dayBookTable(dayBook(l), l)
    expect(db.rows.length).toBe(l.entries.length)
    const csv = toCsv(toCsvRows(trialBalanceTable(trialBalance(l))))
    expect(csv.split('\r\n')[0]).toBe('Code,Account,Debit,Credit')
    const html = tableHtml('<Shop & Co>', { ...pl, title: '<b>P&L</b>' })
    expect(html).toContain('&lt;Shop &amp; Co&gt;')
    expect(html).not.toContain('<b>P&L</b>')
  })
})
