import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBankDate } from '@/features/accounting/statementCsv'
import { parseMt940, parseOfx, parseQif, readStatementFile } from '@/features/accounting/statementFile'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
describe('bank statement files', () => {
  it('reads dates written the many ways banks write them', () => {
    expect(['2026-04-30', '30/04/2026', '30-04-26', '30 Apr 2026', '30-Apr-26', '30.04.2026', '2026-04-30 10:00:00'].map(parseBankDate)).toEqual(Array(7).fill('2026-04-30'))
    expect(parseBankDate('April')).toBeNull()
  })
  it('reads OFX with its closing balance', () => {
    const r = parseOfx('OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260402120000<TRNAMT>11800.00<FITID>A1<NAME>ASHA TRADERS<MEMO>UPI payment</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260405<TRNAMT>-2500.50<CHECKNUM>778<NAME>VENDOR</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>109299.50<DTASOF>20260430</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>')
    expect(r.lines).toEqual([{ date: '2026-04-02', description: 'UPI payment', reference: 'A1', amount: '11800.0000' }, { date: '2026-04-05', description: 'VENDOR', reference: '778', amount: '-2500.5000' }])
    expect(r).toMatchObject({ closing: '109299.5000', opening: '100000.0000' })
  })
  it('reads QIF', () => {
    const r = parseQif('!Type:Bank\nD02/04/2026\nT11,800.00\nPUPI ASHA\nN123\n^\nD05/04/2026\nT-2,500.50\nPVENDOR\n^\n')
    expect(r.lines.map((l) => [l.date, l.amount, l.description])).toEqual([['2026-04-02', '11800.0000', 'UPI ASHA'], ['2026-04-05', '-2500.5000', 'VENDOR']])
  })
  it('reads MT940 with balances and narratives', () => {
    const r = parseMt940(':20:STMT\n:25:50100012345678\n:60F:C260401INR100000,00\n:61:2604020402C11800,00NTRFREF123//BANKREF\n:86:UPI ASHA TRADERS\nPAYMENT\n:61:2604050405D2500,50NCHQ778\n:86:NEFT VENDOR\n:62F:C260430INR109299,50\n-')
    expect(r.lines).toMatchObject([{ date: '2026-04-02', amount: '11800.0000', description: 'UPI ASHA TRADERS PAYMENT', reference: 'REF123' }, { date: '2026-04-05', amount: '-2500.5000' }])
    expect(r).toMatchObject({ opening: '100000.0000', closing: '109299.5000' })
  })
  it('reads an Excel statement with the bank name and summary above and below the table', async () => {
    const r = await readStatementFile('hdfc.xlsx', new Uint8Array(readFileSync('tests/fixtures/import/bank.xlsx')))
    expect(r.lines).toEqual([{ date: '2026-04-02', description: 'UPI-ASHA TRADERS-PAYMENT', reference: 'UPI123', amount: '11800.0000' }, { date: '2026-04-05', description: 'NEFT-VENDOR SUPPLIES', reference: 'NEFT55', amount: '-2500.5000' }])
    expect(r).toMatchObject({ format: 'Excel workbook', opening: '100000.0000', closing: '109299.5000', errors: [] })
  })
  it('reads a semicolon CSV with Dr/Cr columns and refuses a file with no transactions', async () => {
    const r = await readStatementFile('x.csv', enc('Txn Date;Particulars;Debit;Credit\n02/04/2026;Cheque 55;1,000.00;\n03/04/2026;Interest;;12.50\n'))
    expect(r.lines.map((l) => l.amount)).toEqual(['-1000.0000', '12.5000'])
    const bad = await readStatementFile('y.csv', enc('Name,City\nA,B\n'))
    expect(bad.lines).toEqual([]); expect(bad.errors[0]).toMatch(/Date and Description/)
  })
})
