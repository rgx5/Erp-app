import { ctx, NOW } from '@/data/__tests__/helpers'
import { OpError, receivePurchase } from '@/data/ops'
import { applyChanges } from '@/data/state'
import { isBalanced, postingsFor } from '@/modules/postings'
import '@/modules/accounting/postings'
import { rig } from '@/replication/testkit'
import { itcClosingSoon, itcDeadline, itcExpired, itcFor, itcRegister, splitTax } from '../itc'
import { payables, supplierStatement } from '../payables'
import { recordPurchaseInvoice, reversePurchaseInvoice, type InvoiceDraft } from '../ops-invoices'
import { paySupplier } from '../ops-payables'
import { itcCsv } from '../reports'
import { GUJ_SUPPLIER, purchasingState, withReceipt, DAY } from './helpers'

const day = (n: number) => NOW - n * DAY
const svc: InvoiceDraft = { supplierId: 's1', invoiceNo: 'INV/22', invoiceDate: day(2), kind: 'services', head: 'Repairs', lines: [{ description: 'AC repair', hsn: '9987', taxable: 1000, rate: 18 }] }

describe('GST on a purchase invoice', () => {
  test('tax splits into CGST + SGST inside the state and IGST across it', () => {
    expect(splitTax(1000, 18, false)).toEqual({ cgst: 90, sgst: 90, igst: 0 })
    expect(splitTax(1000, 18, true)).toEqual({ cgst: 0, sgst: 0, igst: 180 })
  })

  test('a local supplier: totals, credit and what is owed', () => {
    const s = purchasingState()
    const { invoice } = recordPurchaseInvoice(s, svc, ctx())
    expect(invoice).toMatchObject({ no: 'PI-0001', interState: false, taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180, payable: 1180, basis: 'standalone' })
    expect(invoice.itc).toEqual({ eligible: true, reason: '', cgst: 90, sgst: 90, igst: 0 })
    expect(payables(applyChanges(s, recordPurchaseInvoice(s, svc, ctx()).changes)).bySupplier.s1.net).toBe(1180)
  })

  test('another state’s supplier charges IGST', () => {
    const { invoice } = recordPurchaseInvoice(purchasingState(), { ...svc, supplierId: 's2' }, ctx())
    expect(invoice).toMatchObject({ interState: true, igst: 180, cgst: 0, supplierGstin: GUJ_SUPPLIER })
    expect(invoice.itc.igst).toBe(180)
  })

  test('the printed total must match; a rupee of rounding becomes the round-off', () => {
    const s = purchasingState()
    expect(() => recordPurchaseInvoice(s, { ...svc, printedTotal: 1300 }, ctx())).toThrow('1300')
    const r = recordPurchaseInvoice(s, { ...svc, printedTotal: 1180.4 }, ctx()).invoice
    expect(r).toMatchObject({ roundOff: 0.4, total: 1180.4, payable: 1180.4 })
  })

  test('credit is refused with a reason when it cannot be claimed', () => {
    const s = purchasingState()
    const base = { supplierGstin: '27BBBBB1111B1Z', storeRegistration: 'regular' as const, blocked: 'none' as const, cgst: 9, sgst: 9, igst: 0, invoiceDate: day(1), asOf: NOW }
    expect(itcFor({ ...base, supplierGstin: '' }).reason).toContain('no GSTIN')
    expect(itcFor({ ...base, supplierGstin: 'BADGSTIN' }).reason).toContain('not valid')
    expect(itcFor({ ...base, supplierGstin: purchasingState().suppliers.s1.gstin, storeRegistration: 'composition' }).reason).toContain('not a regular')
    expect(itcFor({ ...base, supplierGstin: purchasingState().suppliers.s1.gstin, blocked: 'food' }).reason).toContain('food')
    expect(itcFor({ ...base, supplierGstin: purchasingState().suppliers.s1.gstin, cgst: 0, sgst: 0 }).reason).toContain('No GST')
    const noGstin = purchasingState({ supplier: { gstin: '' } })
    expect(recordPurchaseInvoice(noGstin, svc, ctx()).invoice.itc.eligible).toBe(false)
    const blocked = recordPurchaseInvoice(s, { ...svc, blocked: 'vehicle' }, ctx()).invoice
    expect(blocked.itc).toMatchObject({ eligible: false, cgst: 0 })
    expect(blocked.total).toBe(1180) // still owed in full
  })

  test('the claim window: 30 November after the financial year', () => {
    const inv = new Date(2025, 5, 10).getTime() // FY 2025-26
    expect(new Date(itcDeadline(inv))).toEqual(new Date(2026, 10, 30, 23, 59, 59, 999))
    expect(itcExpired(inv, new Date(2026, 10, 30, 12).getTime())).toBe(false)
    expect(itcExpired(inv, new Date(2026, 11, 1).getTime())).toBe(true)
    const old = recordPurchaseInvoice(purchasingState(), { ...svc, invoiceDate: new Date(2024, 5, 1).getTime() }, ctx()).invoice
    expect(old.itc.eligible).toBe(false)
    expect(old.itc.reason).toContain('time limit')
    // an invoice from April 2026 can still be claimed until Nov 2027
    const s = applyChanges(purchasingState(), recordPurchaseInvoice(purchasingState(), { ...svc, invoiceDate: day(1) }, ctx()).changes)
    expect(itcClosingSoon(s, new Date(2027, 10, 5).getTime(), 30)).toHaveLength(1)
  })

  test('refusals: duplicate invoice, no number, future date, bad lines, reverse charge is not offered', () => {
    const s = purchasingState()
    const once = applyChanges(s, recordPurchaseInvoice(s, svc, ctx()).changes)
    expect(() => recordPurchaseInvoice(once, { ...svc, invoiceNo: 'inv/22' }, ctx())).toThrow('already entered')
    expect(() => recordPurchaseInvoice(s, { ...svc, invoiceNo: ' ' }, ctx())).toThrow('number')
    expect(() => recordPurchaseInvoice(s, { ...svc, invoiceDate: NOW + 5 * DAY }, ctx())).toThrow('future')
    expect(() => recordPurchaseInvoice(s, { ...svc, lines: [] }, ctx())).toThrow('at least one')
    expect(() => recordPurchaseInvoice(s, { ...svc, lines: [{ description: '', hsn: '', taxable: 0, rate: 5 }] }, ctx())).toThrow('amount before tax')
    expect(() => recordPurchaseInvoice(s, { ...svc, lines: [{ description: '', hsn: '', taxable: 5, rate: 90 }] }, ctx())).toThrow('0 to 40')
    expect(() => recordPurchaseInvoice(s, { ...svc, supplierId: 'nope' }, ctx())).toThrow(OpError)
    expect(() => recordPurchaseInvoice(s, { ...svc, kind: 'services', purchaseId: 'x' }, ctx())).toThrow('goods')
  })
})

describe('an invoice for goods already received', () => {
  const goods = (purchaseId: string, taxable: number, rate = 5): InvoiceDraft => ({ supplierId: 's1', invoiceNo: 'G-1', invoiceDate: day(1), kind: 'goods', purchaseId, lines: [{ description: 'Shirts', hsn: '6205', taxable, rate }] })

  test('receipt entered at the invoice total: only the tax moves out of stock', () => {
    const { state, purchase } = withReceipt(purchasingState(), { total: 6300 }) // 6000 + 5%
    const r = recordPurchaseInvoice(state, goods(purchase.id, 6000), ctx())
    expect(r.invoice).toMatchObject({ basis: 'receipt-gross', payable: 0, total: 6300 })
    expect(payables(applyChanges(state, r.changes)).bySupplier.s1.net).toBe(6300) // not doubled
    const posting = postingsFor(applyChanges(state, r.changes)).find((p) => p.sourceColl === 'purchaseInvoices')!
    expect(posting.lines).toEqual([{ account: 'gst_input_cgst', debit: 150 }, { account: 'gst_input_sgst', debit: 150 }, { account: 'inventory', credit: 300 }])
    expect(isBalanced(posting)).toBe(true)
  })

  test('receipt entered before tax: the tax is added to what is owed', () => {
    const { state, purchase } = withReceipt(purchasingState(), { total: 6000 })
    const r = recordPurchaseInvoice(state, goods(purchase.id, 6000), ctx())
    expect(r.invoice).toMatchObject({ basis: 'receipt-net', payable: 300 })
    const after = applyChanges(state, r.changes)
    expect(payables(after).bySupplier.s1.net).toBe(6300)
    expect(supplierStatement(after, 's1', 0, NOW + DAY).closing).toBe(6300)
    const posting = postingsFor(after).find((p) => p.sourceColl === 'purchaseInvoices')!
    expect(isBalanced(posting)).toBe(true)
    expect(posting.lines.find((l) => l.account === 'payables')).toMatchObject({ credit: 300, party: { type: 'supplier', id: 's1' } })
  })

  test('a receipt that matches neither is refused, as is a second invoice or another supplier’s receipt', () => {
    const { state, purchase } = withReceipt(purchasingState(), { total: 7000 })
    expect(() => recordPurchaseInvoice(state, goods(purchase.id, 6000), ctx())).toThrow('Correct one of them')
    const ok = withReceipt(purchasingState(), { total: 6300 })
    const done = applyChanges(ok.state, recordPurchaseInvoice(ok.state, goods(ok.purchase.id, 6000), ctx()).changes)
    expect(() => recordPurchaseInvoice(done, { ...goods(ok.purchase.id, 6000), invoiceNo: 'G-2' }, ctx())).toThrow('already has an invoice')
    expect(() => recordPurchaseInvoice(ok.state, { ...goods(ok.purchase.id, 6000), supplierId: 's2' }, ctx())).toThrow('different supplier')
  })
})

describe('postings and cancelling', () => {
  test('a standalone invoice books cost, credit and the debt; the blocked tax stays in the cost', () => {
    const s = purchasingState()
    const eligible = recordPurchaseInvoice(s, svc, ctx({ now: NOW })).invoice
    const food = recordPurchaseInvoice(s, { ...svc, invoiceNo: 'F-1', blocked: 'food', head: 'Staff meals' }, ctx({ now: NOW + 1 })).invoice
    const st = applyChanges(s, { put: { purchaseInvoices: [eligible, food] } })
    const [a, b] = postingsFor(st).filter((p) => p.sourceColl === 'purchaseInvoices')
    const find = (p: typeof a) => Object.fromEntries(p.lines.map((l) => [l.account, l.debit ?? l.credit]))
    expect(find(a)).toEqual({ 'expense:Repairs': 1000, gst_input_cgst: 90, gst_input_sgst: 90, payables: 1180 })
    expect(find(b)).toEqual({ 'expense:Staff meals': 1180, payables: 1180 })
    expect(isBalanced(a) && isBalanced(b)).toBe(true)
  })

  test('cancelling removes it from what is owed and from the register, and posts the opposite', () => {
    const s = purchasingState()
    const r = recordPurchaseInvoice(s, svc, ctx())
    const have = applyChanges(s, r.changes)
    expect(itcRegister(have, day(10), NOW).eligible.total).toBe(180)
    const gone = applyChanges(have, reversePurchaseInvoice(have, r.invoice.id, 'entered twice', ctx({ now: NOW + 3 })).changes)
    expect(payables(gone).total).toBe(0)
    expect(itcRegister(gone, day(10), NOW).rows).toHaveLength(0)
    const ps = postingsFor(gone).filter((p) => p.sourceColl === 'purchaseInvoices')
    expect(ps).toHaveLength(2)
    expect(ps.every(isBalanced)).toBe(true)
    expect(ps[1].lines.find((l) => l.account === 'payables')).toMatchObject({ debit: 1180 })
    // once cancelled, the same invoice number can be entered again
    expect(() => recordPurchaseInvoice(gone, svc, ctx())).not.toThrow()
  })

  test('the ITC register adds up credit, blocked tax and credit given back on returns', () => {
    let s = purchasingState()
    s = applyChanges(s, recordPurchaseInvoice(s, svc, ctx({ now: NOW })).changes)
    s = applyChanges(s, recordPurchaseInvoice(s, { ...svc, invoiceNo: 'B-9', blocked: 'gifts' }, ctx({ now: NOW + 1 })).changes)
    s = applyChanges(s, recordPurchaseInvoice(s, { ...svc, invoiceNo: 'I-3', supplierId: 's2' }, ctx({ now: NOW + 2 })).changes)
    const reg = itcRegister(s, day(30), NOW + DAY)
    expect(reg.rows).toHaveLength(3)
    expect(reg.eligible).toEqual({ cgst: 90, sgst: 90, igst: 180, total: 360 })
    expect(reg.blocked.total).toBe(180)
    expect(reg.net.total).toBe(360)
    expect(itcRegister(s, day(30), day(5)).rows).toHaveLength(0)
    expect(itcCsv(s, day(30), NOW + DAY)).toContain('Credit to claim')
  })
})

describe('purchase invoices replicate', () => {
  test('server == phone: invoices, a reversal, and the supplier’s balance', async () => {
    const r = rig(purchasingState())
    await r.seed()
    const first = await r.run((s) => recordPurchaseInvoice(s, svc, ctx({ now: NOW + 1 })))
    await r.run((s) => recordPurchaseInvoice(s, { ...svc, invoiceNo: 'INV/23', supplierId: 's2' }, ctx({ now: NOW + 2 })))
    await r.run((s) => reversePurchaseInvoice(s, first.invoice.id, 'wrong', ctx({ now: NOW + 3 })))
    await r.run((s) => paySupplier(s, { supplierId: 's2', amount: 100, mode: 'cash' }, ctx({ now: NOW + 4 })))
    const server = await r.serverView()
    expect(server.purchaseInvoices).toEqual(r.phone.purchaseInvoices)
    expect(server.suppliers).toEqual(r.phone.suppliers)
    expect(server.suppliers.s1.payableAdjust).toBe(0)
    expect(server.suppliers.s2.payableAdjust).toBe(1180 - 100)
  })

  test('a receipt-linked invoice does not double the debt on the server either', async () => {
    const r = rig(purchasingState())
    await r.seed()
    const got = await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'B', items: [{ variantId: 'v1', qty: 10, cost: 600 }], total: 6000, paid: 0, notes: '' }, ctx({ now: NOW })))
    await r.run((s) => recordPurchaseInvoice(s, { supplierId: 's1', invoiceNo: 'G', invoiceDate: NOW, kind: 'goods', purchaseId: got.purchase.id, lines: [{ description: '', hsn: '', taxable: 6000, rate: 5 }] }, ctx({ now: NOW + 1 })))
    const server = await r.serverView()
    expect(server.suppliers.s1.payableAdjust).toBe(300)
    expect(server.suppliers).toEqual(r.phone.suppliers)
    expect(payables(r.phone).total).toBe(6300)
  })
})
