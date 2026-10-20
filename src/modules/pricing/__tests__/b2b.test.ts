import { saveBill } from '@/data/ops'
import { ctx } from '@/data/__tests__/helpers'
import { OpError } from '@/data/ops'
import { applyChanges, listOf } from '@/data/state'
import { taxInfoOf } from '@/domain/gst'
import { invoiceHtml, receiptHtml, receiptText } from '@/domain/receipt'
import { receiptAddOns } from '../../registry'
import { b2bRegister, billTaxInfo, checkBuyer, registerCsv, registerTotals, supplySummary, taxInconsistency } from '../b2b'
import { cartLine, KA, MH, sale, shop } from './helpers'

describe('what a bill will be', () => {
  test('a regular dealer: CGST + SGST within the state, IGST across it', () => {
    const s = shop()
    expect(supplySummary(s.store, s.customers.c2).tax).toBe('CGST + SGST')
    const inter = supplySummary(s.store, s.customers.c1)
    expect(inter).toMatchObject({ tax: 'IGST', interState: true, kind: 'tax_invoice', isB2B: true, placeOfSupply: '29' })
    expect(supplySummary(s.store, s.customers.c1, { placeOfSupply: '27' }).tax).toBe('CGST + SGST')
  })
  test('composition and unregistered dealers issue a bill of supply', () => {
    const s = shop({ registrationType: 'composition' })
    expect(supplySummary(s.store, s.customers.c1)).toMatchObject({ kind: 'bill_of_supply', tax: 'No GST', isB2B: false })
    expect(billTaxInfo(s.store, null)).toEqual({ taxMode: 'bill_of_supply' })
    expect(billTaxInfo(shop().store, null)).toBeUndefined()
  })
  test('derived fields are recorded on the info', () => {
    const s = shop()
    expect(billTaxInfo(s.store, null, { buyerGstin: ` ${KA.toLowerCase()} `, reverseCharge: true })).toEqual({ buyerGstin: KA, reverseCharge: true, taxMode: 'tax_invoice', interState: true })
  })
})

describe('checking the buyer', () => {
  test('a mistyped GSTIN or state stops the bill; warnings do not', () => {
    const s = shop()
    expect(checkBuyer(s.store, null, { buyerGstin: KA.slice(0, 14) + (KA[14] === '0' ? '1' : '0') }).errors[0]).toMatch(/Buyer GSTIN/)
    expect(checkBuyer(s.store, null, { placeOfSupply: '25' }).errors[0]).toMatch(/not a GST state code/)
    expect(checkBuyer(s.store, null, { buyerGstin: KA }).errors).toEqual([])
    expect(checkBuyer(shop({ gstin: '' }).store, null, {}).warnings[0]).toMatch(/own GSTIN/)
    expect(checkBuyer(shop({ registrationType: 'composition' }).store, null, { placeOfSupply: '29' }).warnings.join()).toMatch(/composition dealer cannot/)
  })
})

describe('an inter-state sale through the bill hook', () => {
  test('is IGST on every line, saves, prints IGST and the buyer', () => {
    const s = shop()
    const input = sale(s, [cartLine(s, 'v1', 2)], { customerId: 'c1' })
    expect(input.igstTotal).toBeGreaterThan(0)
    expect(input.cgstTotal + input.sgstTotal).toBe(0)
    expect(input.taxTotal).toBe(input.igstTotal)
    const { bill } = saveBill(s, input, ctx())
    expect(taxInfoOf(bill)).toMatchObject({ taxMode: 'tax_invoice', interState: true })
    const store = s.store!
    const html = invoiceHtml({ bill, store, customer: s.customers.c1, extras: receiptAddOns(bill, s) })
    expect(html).toContain('TAX INVOICE')
    expect(html).toContain('IGST')
    expect(html).not.toContain('CGST')
    expect(html).toContain(`GSTIN: ${KA}`)
    expect(html).toContain('Place of supply: Karnataka (29)')
    expect(receiptHtml({ bill, store, customer: s.customers.c1 }, { showTax: true, showHsn: true, showSavings: true, showLoyalty: true })).toContain('IGST')
  })
  test('a bill that says IGST but was priced local is refused', () => {
    const s = shop()
    const good = sale(s, [cartLine(s, 'v1')], { customerId: 'c1' })
    const local = sale(s, [cartLine(s, 'v1')], { customerId: 'c1', info: { placeOfSupply: '27' } })
    expect(() => saveBill(s, { ...good, cgstTotal: local.cgstTotal, sgstTotal: local.sgstTotal, items: local.items, taxTotal: local.taxTotal }, ctx())).toThrow(OpError)
    expect(() => saveBill(s, { ...local, ext: good.ext }, ctx())).toThrow(/IGST/)
  })
  test('a bill with a mistyped GSTIN is refused', () => {
    const s = shop()
    const input = sale(s, [cartLine(s, 'v1')], { customerId: 'c2' })
    expect(() => saveBill(s, { ...input, ext: { pricing: { buyerGstin: 'NOTAGSTIN', taxMode: 'tax_invoice' } } }, ctx())).toThrow(/Buyer GSTIN/)
  })
  test('bills from other flows (no tax info) are never held up', () => {
    const s = shop()
    const plain = sale(s, [cartLine(s, 'v1')], { customerId: 'c1' })
    const { ext: _e, ...noExt } = { ...plain, igstTotal: undefined }
    void _e
    expect(taxInconsistency({ ...noExt, id: 'x', no: 'N' } as never, s.store, s.customers.c1)).toBeNull()
  })
})

describe('a composition dealer’s bill of supply', () => {
  test('charges nothing, prints "bill of supply", and a taxed bill is refused', () => {
    const s = shop({ registrationType: 'composition' })
    const input = sale(s, [cartLine(s, 'v1', 2)], { customerId: 'c2' })
    expect(input.taxTotal).toBe(0)
    expect(input.total).toBe(1998)
    const { bill } = saveBill(s, input, ctx())
    const doc = { bill, store: s.store!, customer: s.customers.c2 }
    expect(invoiceHtml(doc)).toContain('BILL OF SUPPLY')
    expect(invoiceHtml(doc)).toContain('Composition taxable person')
    expect(receiptText(doc)).toContain('Bill of supply')
    const taxed = sale(shop(), [cartLine(s, 'v1', 2)], { customerId: 'c2' })
    expect(() => saveBill(s, { ...taxed, ext: input.ext }, ctx())).toThrow(/bills of supply/)
  })
})

describe('the B2B register', () => {
  test('lists registered-buyer invoices with the tax split, and totals them', () => {
    let s = shop()
    for (const [cid, now] of [['c1', 1], ['c2', 2], ['c1', 3]] as const) {
      const { changes } = saveBill(s, sale(s, [cartLine(s, 'v1')], { customerId: cid, now: new Date('2026-10-19T10:00:00').getTime() + now }), ctx({ now: new Date('2026-10-19T10:00:00').getTime() + now }))
      s = applyChanges(s, changes)
    }
    const rows = b2bRegister(listOf(s.bills), s.customers, 0, Date.now() + 1e12)
    expect(rows).toHaveLength(2) // the walk-in-style customer has no GSTIN
    expect(rows[0]).toMatchObject({ kind: 'Tax invoice', buyerGstin: KA, placeOfSupply: '29', cgst: 0, sgst: 0 })
    expect(rows[0].igst).toBeGreaterThan(0)
    const t = registerTotals(rows)
    expect(t.count).toBe(2)
    expect(t.total).toBe(rows[0].total + rows[1].total)
    const csv = registerCsv(rows)
    expect(csv[0][0]).toBe('Invoice no')
    expect(csv[1][5]).toBe('29-Karnataka')
    expect(MH).toBeTruthy()
  })
})
