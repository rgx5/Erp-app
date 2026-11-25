import { describe, expect, it } from 'vitest'
import { normNumber, parseGstr2b, portalDate, reconcile, summarize, type BookBill } from '@/features/gst/gstr2b'

const file = { data: { gstin: '27ABCDE1234F1Z5', rtnprd: '042026', docdata: {
  b2b: [{ ctin: '29KLMNO9012P1Z5', trdnm: 'Vendor Supplies', inv: [
    { inum: 'INV/0001', dt: '05-04-2026', val: 1180, itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 1000, igst: 180, cgst: 0, sgst: 0, cess: 0 }] },
    { inum: 'V-77', dt: '10-04-2026', val: 590, items: [{ rt: 18, txval: 500, igst: 90 }] },
    { inum: 'V-88', dt: '12-04-2026', val: 236, itcavl: 'N', rsn: 'POS', items: [{ itm_det: { rt: 18, txval: 200, iamt: 36 } }] },
    { inum: 'ONLY-IN-PORTAL', dt: '20-04-2026', val: 118, items: [{ txval: 100, igst: 18 }] }] }],
  cdnr: [{ ctin: '29KLMNO9012P1Z5', trdnm: 'Vendor Supplies', nt: [{ ntnum: 'CN-1', typ: 'C', dt: '15-04-2026', val: 118, items: [{ txval: 100, igst: 18 }] }] }] } } }
const bill = (o: Partial<BookBill>): BookBill => ({ id: Math.random().toString(), billNo: 'PB/1', supplierInvoiceNo: 'x', supplierInvoiceDate: '2026-04-05', billDate: '2026-04-06', supplierGstin: '29KLMNO9012P1Z5', supplierName: 'Vendor Supplies', documentType: 'bill', taxable: 1000, igst: 180, cgst: 0, sgst: 0, cess: 0, reverseCharge: false, status: 'posted', ...o })

describe('GSTR-2B reconciliation', () => {
  it('reads the portal file in both item layouts, notes, dates and the period', () => {
    const r = parseGstr2b(file)
    expect(r.period).toBe('2026-04'); expect(r.gstin).toBe('27ABCDE1234F1Z5'); expect(r.docs).toHaveLength(5)
    expect(r.docs[0]).toMatchObject({ kind: 'invoice', number: 'INV/0001', date: '2026-04-05', taxable: 1000, igst: 180, itcAvailable: true })
    expect(r.docs[2]).toMatchObject({ itcAvailable: false, igst: 36, reason: 'POS' }); expect(r.docs[4]).toMatchObject({ kind: 'credit_note', number: 'CN-1' })
    expect(() => parseGstr2b({ hello: 1 })).toThrow(/GSTR-2B/)
    expect(portalDate('05-04-2026')).toBe('2026-04-05'); expect(normNumber('INV/0001')).toBe(normNumber('inv-1'))
  })
  it('matches, flags differences, finds possible matches, and lists what is on one side only', () => {
    const books = [
      bill({ supplierInvoiceNo: 'INV-1' }),                                                       // same number in another spelling: matched
      bill({ supplierInvoiceNo: 'V-77', supplierInvoiceDate: '2026-04-10', taxable: 500, igst: 80 }),   // tax differs: mismatch
      bill({ supplierInvoiceNo: 'RENAMED', supplierInvoiceDate: '2026-04-12', taxable: 200, igst: 36 }),  // numbered differently: possible
      bill({ supplierInvoiceNo: 'BOOKS-ONLY', supplierInvoiceDate: '2026-04-25', taxable: 300, igst: 54 }),
      bill({ supplierInvoiceNo: 'CN-1', documentType: 'debit_note', supplierInvoiceDate: '2026-04-15', taxable: 100, igst: 18 }),
      bill({ supplierInvoiceNo: 'CANCELLED', status: 'cancelled' }),
    ]
    const rows = reconcile(parseGstr2b(file).docs, books)
    const by = (num: string) => rows.find((r) => r.number === num)
    expect(by('INV/0001')?.status).toBe('matched'); expect(by('V-77')?.status).toBe('mismatch'); expect(by('V-77')?.differences[0]).toMatch(/IGST: portal 90.00, books 80.00/)
    expect(by('V-88')?.status).toBe('possible'); expect(by('ONLY-IN-PORTAL')?.status).toBe('only_2b'); expect(by('BOOKS-ONLY')?.status).toBe('only_books'); expect(by('CN-1')?.status).toBe('matched')
    expect(rows.some((r) => r.number === 'CANCELLED')).toBe(false) // a cancelled bill is not in the books
    const sum = summarize(rows); expect(sum.find((s) => s.status === 'only_2b')).toMatchObject({ count: 1, portalTax: 18 }); expect(sum.find((s) => s.status === 'only_books')).toMatchObject({ count: 1, bookTax: 54 })
  })
  it('does not pair one bill with two portal documents, and tolerates a rupee of rounding', () => {
    const f = { docdata: { b2b: [{ ctin: '29KLMNO9012P1Z5', inv: [{ inum: 'A1', dt: '05-04-2026', items: [{ txval: 1000.4, igst: 179.6 }] }, { inum: 'A1', dt: '05-04-2026', items: [{ txval: 1000, igst: 180 }] }] }] } }
    const rows = reconcile(parseGstr2b(f).docs, [bill({ supplierInvoiceNo: 'A1' })])
    expect(rows.map((r) => r.status).sort()).toEqual(['matched', 'only_2b'])
  })
})
