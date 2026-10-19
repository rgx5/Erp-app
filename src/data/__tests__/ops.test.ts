import { isValidEan13 } from '@/domain/barcode'
import {
  addExpense, addVariants, adjustStock, closeDay, createItem, deleteCategory, deleteProduct, hasHistory, nextCreditNoteNo, nextInvoiceNo,
  openDay, OpError, postCount, priceVariants, processReturn, receivePurchase, saveBill, saveCategory, saveCoupon, saveCustomer, saveStaff,
  saveSupplier, setAllVariants, updateProduct, updateSettings, updateVariant,
} from '../ops'
import { listOf, mergeChanges, applyChanges } from '../state'
import { apply, baseState, billInput, ctx, customer, line, NOW, owner, variant } from './helpers'

describe('createItem', () => {
  const draft = { name: 'Linen Shirt', styleCode: 'ms-201', categoryId: 'cat_mshirt', brand: '', fabric: '', season: '', hsn: '6205', sizes: ['M', 'L', 'XL'], colors: ['White', 'Blue'], cost: 300, mrp: 999, price: 799 }

  test('makes one barcoded variant per size × colour', () => {
    const s = baseState()
    const { product, variants, changes } = createItem(s, draft, ctx())
    expect(product.styleCode).toBe('MS-201')
    expect(variants).toHaveLength(6)
    expect(new Set(variants.map((v) => v.barcode)).size).toBe(6)
    expect(variants.every((v) => isValidEan13(v.barcode))).toBe(true)
    expect(variants.map((v) => v.sku)).toContain('MS-201-WHI-M')
    expect(changes.outbox!.map((o) => o.entity)).toEqual(['product', ...Array(6).fill('variant')])
  })

  test('opening stock goes through the ledger, and reaches the server as adjustments', () => {
    const s = baseState()
    const { variants, changes } = createItem(s, { ...draft, sizes: ['M'], colors: [''], openingStock: 12 }, ctx())
    expect(variants[0].stock).toBe(12)
    expect(changes.put!.moves).toHaveLength(1)
    expect(changes.put!.moves![0]).toMatchObject({ type: 'opening', qty: 12 })
    expect(changes.outbox!.map((o) => o.entity)).toEqual(['product', 'variant', 'stockAdjust'])
    // the variant row itself is uploaded at 0: the adjustment carries the stock
    expect((changes.outbox![1].payload as { stock: number }).stock).toBe(0)
  })

  test('price 0 means waiting for a price', () => {
    const { variants } = createItem(baseState(), { ...draft, sizes: ['M'], colors: [''], price: 0, mrp: 0 }, ctx())
    expect(variants[0].unpricedSince).toBe(NOW)
  })

  test('refuses a duplicate item code and a nameless item', () => {
    expect(() => createItem(baseState(), { ...draft, styleCode: 'MS-101' }, ctx())).toThrow(OpError)
    expect(() => createItem(baseState(), { ...draft, name: ' ' }, ctx())).toThrow('name')
  })

  test('services hold no opening stock', () => {
    const { variants } = createItem(baseState(), { ...draft, sizes: [''], colors: [''], trackStock: false, openingStock: 5 }, ctx())
    expect(variants[0].stock).toBe(0)
  })

  test('a phone numbers barcodes from its own range', () => {
    const { variants } = createItem(baseState(), { ...draft, sizes: ['M'], colors: [''] }, ctx({ barcodeBase: 400_000_000 }))
    expect(variants[0].barcode.startsWith('210' + '4')).toBe(true)
  })
})

describe('invoice numbering', () => {
  test('an offline workspace uses the store counter', () => {
    let s = baseState({ store: { nextInvoiceNo: 7 } })
    expect(nextInvoiceNo(s, ctx()).no).toBe('INV-0007')
    const { changes } = saveBill(s, billInput(s, [line(s.variants.v1)]), ctx())
    s = apply(s, changes)
    expect(s.store!.nextInvoiceNo).toBe(8)
  })

  test('skips numbers already taken', () => {
    let s = baseState({ store: { nextInvoiceNo: 1 } })
    s = apply(s, saveBill(s, billInput(s, [line(s.variants.v1)]), ctx(), {}).changes)
    s = { ...s, store: { ...s.store!, nextInvoiceNo: 1 } } // counter lowered by mistake
    expect(nextInvoiceNo(s, ctx()).no).toBe('INV-0002')
  })

  test('a connected phone numbers from its own series and never touches the store counter', () => {
    let s = baseState({ store: { nextInvoiceNo: 50 } })
    const c = ctx({ series: 'M4X' })
    const a = saveBill(s, billInput(s, [line(s.variants.v1)]), c)
    expect(a.bill.no).toBe('INV-M4X-0001')
    expect(a.changes.store).toBeUndefined()
    s = apply(s, a.changes)
    expect(saveBill(s, billInput(s, [line(s.variants.v1)]), c).bill.no).toBe('INV-M4X-0002')
    expect(s.store!.nextInvoiceNo).toBe(50)
  })

  test('two phones can never mint the same number', () => {
    const s = baseState()
    const a = nextInvoiceNo(s, ctx({ series: 'AAA' })).no
    const b = nextInvoiceNo(s, ctx({ series: 'BBB' })).no
    expect(a).not.toBe(b)
  })
})

describe('saveBill', () => {
  test('takes stock off the shelf, writes the ledger and queues the bill', () => {
    const s = baseState()
    const { changes, bill } = saveBill(s, billInput(s, [line(s.variants.v1, 2)], { customerId: 'c1', loyaltyEarned: 20, loyaltyRedeemed: 10 }), ctx())
    const next = apply(s, changes)
    expect(next.variants.v1.stock).toBe(8)
    expect(listOf(next.moves)).toEqual([expect.objectContaining({ type: 'sale', qty: -2, ref: bill.no })])
    expect(next.customers.c1.loyaltyPoints).toBe(60)
    expect(changes.outbox).toEqual([{ entity: 'bill', payload: bill }])
    expect(listOf(next.audit)[0].action).toBe('BILL_CREATE')
  })

  test('a parked bill changes nothing but itself and never syncs', () => {
    const s = baseState()
    const { changes, bill } = saveBill(s, billInput(s, [line(s.variants.v1, 2)], { status: 'held', payments: [], paid: 0 }), ctx())
    const next = apply(s, changes)
    expect(bill.no.startsWith('HOLD-')).toBe(true)
    expect(next.variants.v1.stock).toBe(10)
    expect(changes.outbox).toBeUndefined()
  })

  test('paying a parked bill removes the parked copy', () => {
    let s = baseState()
    s = apply(s, saveBill(s, billInput(s, [line(s.variants.v1)], { status: 'held', payments: [], paid: 0 }), ctx()).changes)
    const held = listOf(s.bills)[0]
    const paid = saveBill(s, billInput(s, [line(s.variants.v1)]), ctx(), { heldId: held.id })
    s = apply(s, paid.changes)
    expect(listOf(s.bills).map((b) => b.status)).toEqual(['paid'])
  })

  test('services never touch stock', () => {
    let s = baseState()
    s.products = { p1: { ...s.products.p1, trackStock: false } }
    const { changes } = saveBill(s, billInput(s, [line(s.variants.v1, 3, { noStock: true })]), ctx())
    expect(apply(s, changes).variants.v1.stock).toBe(10)
    expect(changes.put!.moves).toHaveLength(0)
  })

  test('an unpriced sale is logged, and a manager can keep the price', () => {
    let s = baseState()
    s.variants = { ...s.variants, v1: { ...s.variants.v1, price: 0, mrp: 0, unpricedSince: NOW - 86400000 } }
    const l = line(s.variants.v1, 1, { price: 500, mrp: 500 })
    const { changes } = saveBill(s, billInput(s, [l]), ctx(), { unpriced: [{ variantId: 'v1', sku: 'MS-101-NAV-M', name: 'Oxford Shirt', price: 500, qty: 1, save: true, mrp: 500 }] })
    const next = apply(s, changes)
    expect(next.variants.v1.price).toBe(500)
    expect(next.variants.v1.unpricedSince).toBeUndefined()
    expect(listOf(next.audit).map((a) => a.action)).toEqual(expect.arrayContaining(['UNPRICED_SALE', 'PRICE_SET']))
    expect(changes.outbox!.map((o) => o.entity)).toEqual(['bill', 'variantUpdate'])
    expect((changes.outbox![1].payload as { unpricedSince: unknown }).unpricedSince).toBeNull()
  })
})

describe('processReturn', () => {
  function sold() {
    let s = baseState()
    const r = saveBill(s, billInput(s, [line(s.variants.v1, 3)], { customerId: 'c1', loyaltyEarned: 29 }), ctx())
    s = apply(s, r.changes)
    return { s, bill: r.bill }
  }

  test('a partial then a final return settle to exactly what was paid, and stock comes back', () => {
    let { s, bill } = sold()
    const first = processReturn(s, bill.id, [{ variantId: 'v1', qty: 1 }], 'cash', ctx({ now: NOW + 1000 }))
    s = apply(s, first.changes)
    expect(s.bills[bill.id].status).toBe('partial-return')
    expect(s.variants.v1.stock).toBe(8)
    expect(first.creditNote.total).toBeLessThan(0)

    const last = processReturn(s, bill.id, [{ variantId: 'v1', qty: 2 }], 'cash', ctx({ now: NOW + 2000 }))
    s = apply(s, last.changes)
    expect(s.bills[bill.id].status).toBe('returned')
    expect(s.variants.v1.stock).toBe(10)
    expect(Math.abs(first.creditNote.total) + Math.abs(last.creditNote.total)).toBeCloseTo(bill.total, 2)
    expect(s.customers.c1.loyaltyPoints).toBe(50 + 29 - 29) // all earned points taken back
  })

  test('credit notes have their own series and queue as returns', () => {
    const { s, bill } = sold()
    const r = processReturn(s, bill.id, [{ variantId: 'v1', qty: 1 }], 'cash', ctx())
    expect(r.creditNote.no).toBe('CN-0001')
    expect(r.changes.outbox).toEqual([{ entity: 'billReturn', payload: r.creditNote }])
    expect(nextCreditNoteNo(apply(s, r.changes), ctx())).toBe('CN-0002')
    expect(nextCreditNoteNo(apply(s, r.changes), ctx({ series: 'M4X' }))).toBe('CN-M4X-0001')
  })

  test('store credit goes on the customer; a walk-in cannot take it', () => {
    let { s, bill } = sold()
    const r = processReturn(s, bill.id, [{ variantId: 'v1', qty: 1 }], 'credit', ctx())
    s = apply(s, r.changes)
    expect(s.customers.c1.storeCredit).toBe(Math.abs(r.creditNote.total))

    let w = baseState()
    const walkIn = saveBill(w, billInput(w, [line(w.variants.v1)]), ctx())
    w = apply(w, walkIn.changes)
    expect(() => processReturn(w, walkIn.bill.id, [{ variantId: 'v1', qty: 1 }], 'credit', ctx())).toThrow('Attach a customer')
  })

  test('nothing selected, or nothing left to return, is refused', () => {
    let { s, bill } = sold()
    expect(() => processReturn(s, bill.id, [{ variantId: 'v1', qty: 0 }], 'cash', ctx())).toThrow('Nothing selected')
    s = apply(s, processReturn(s, bill.id, [{ variantId: 'v1', qty: 3 }], 'cash', ctx()).changes)
    expect(() => processReturn(s, bill.id, [{ variantId: 'v1', qty: 1 }], 'cash', ctx())).toThrow('Nothing selected')
  })

  test('a late return is allowed but flagged', () => {
    const { s: s0, bill } = sold()
    const s = { ...s0, store: { ...s0.store!, returnWindowDays: 7 } }
    const r = processReturn(s, bill.id, [{ variantId: 'v1', qty: 1 }], 'cash', ctx({ now: NOW + 20 * 86400000 }))
    expect(listOf(apply(s, r.changes).audit).some((a) => a.detail.includes('OUTSIDE 7-DAY WINDOW'))).toBe(true)
  })
})

describe('receivePurchase', () => {
  const grn = (items: Array<{ variantId: string; qty: number; cost: number }>, supplierId = 's1') => ({ supplierId, date: NOW, invoiceRef: 'B-1', items, total: items.reduce((t, i) => t + i.qty * i.cost, 0), paid: 0, notes: '' })

  test('adds stock, blends the average cost and uploads the new cost', () => {
    const s = baseState()
    const { changes, purchase } = receivePurchase(s, grn([{ variantId: 'v1', qty: 10, cost: 500 }]), ctx())
    const next = apply(s, changes)
    expect(purchase.no).toBe('GRN-0001')
    expect(next.variants.v1.stock).toBe(20)
    expect(next.variants.v1.cost).toBe(500)
    expect(next.variants.v1.avgCost).toBe(450) // 10 × 400 + 10 × 500
    expect(changes.outbox!.map((o) => o.entity)).toEqual(['purchase', 'variantUpdate'])
    expect(changes.outbox![1].payload).toEqual({ id: 'v1', cost: 500, avgCost: 450 })
    expect(listOf(next.moves)[0]).toMatchObject({ type: 'purchase', qty: 10 })
  })

  test('logs a cost change', () => {
    const s = baseState()
    const next = apply(s, receivePurchase(s, grn([{ variantId: 'v1', qty: 1, cost: 450 }]), ctx()).changes)
    expect(listOf(next.audit).map((a) => a.action)).toEqual(expect.arrayContaining(['PURCHASE', 'COST_CHANGE']))
  })

  test('needs a supplier and items', () => {
    const s = baseState()
    expect(() => receivePurchase(s, grn([{ variantId: 'v1', qty: 1, cost: 1 }], 'nope'), ctx())).toThrow('supplier')
    expect(() => receivePurchase(s, grn([]), ctx())).toThrow('Add at least one')
  })

  test('numbers keep counting', () => {
    let s = baseState()
    s = apply(s, receivePurchase(s, grn([{ variantId: 'v1', qty: 1, cost: 1 }]), ctx()).changes)
    expect(receivePurchase(s, grn([{ variantId: 'v1', qty: 1, cost: 1 }]), ctx()).purchase.no).toBe('GRN-0002')
  })
})

describe('stock', () => {
  test('adjust writes the ledger and syncs as a stock adjustment', () => {
    const s = baseState()
    const { changes } = adjustStock(s, 'v1', -2, 'adjust', 'MANUAL', 'Damaged piece', ctx())
    const next = apply(s, changes)
    expect(next.variants.v1.stock).toBe(8)
    expect(changes.outbox![0].entity).toBe('stockAdjust')
  })
  test('cannot go below zero', () => {
    expect(() => adjustStock(baseState(), 'v2', -5, 'adjust', 'MANUAL', 'x', ctx())).toThrow('below zero')
  })
  test('a physical count posts only the differences', () => {
    const s = baseState()
    const next = apply(s, postCount(s, [{ variantId: 'v1', variance: -1 }, { variantId: 'v2', variance: 0 }], ctx()))
    expect(next.variants.v1.stock).toBe(9)
    expect(listOf(next.moves)).toHaveLength(1)
    expect(listOf(next.moves)[0].type).toBe('audit')
  })
})

describe('pricing & catalogue edits', () => {
  test('priceVariants clears the waiting flag on the server too', () => {
    const s = baseState()
    s.variants = { ...s.variants, v1: { ...s.variants.v1, price: 0, unpricedSince: 5 } }
    const { changes } = priceVariants(s, [{ id: 'v1', price: 799, mrp: 999 }], ctx())
    expect(apply(s, changes).variants.v1).toMatchObject({ price: 799, mrp: 999, unpricedSince: undefined })
    expect(changes.outbox![0].payload).toEqual({ id: 'v1', price: 799, mrp: 999, unpricedSince: null })
  })

  test('updateVariant never carries stock', () => {
    const { changes } = updateVariant(baseState(), 'v1', { price: 1100 }, ctx())
    expect(changes.outbox![0].payload).not.toHaveProperty('stock')
  })

  test('setAllVariants edits every size', () => {
    const s = baseState()
    const { changes, count } = setAllVariants(s, 'p1', 'price', 1050, ctx())
    expect(count).toBe(2)
    const next = apply(s, changes)
    expect(next.variants.v1.price).toBe(1050)
    expect(next.variants.v2.price).toBe(1050)
  })

  test('addVariants skips combinations that exist', () => {
    const s = baseState()
    const { made, changes } = addVariants(s, 'p1', ['M', 'XL'], ['Navy'], ctx())
    expect(made).toBe(1) // M/Navy exists
    expect(apply(s, changes).variants[changes.put!.variants![0].id].size).toBe('XL')
  })

  test('product edits sync (the billing app never sent these)', () => {
    const s = baseState()
    const { changes } = updateProduct(s, 'p1', { name: 'Oxford Shirt Slim', gstRate: undefined }, ctx())
    expect(changes.outbox![0]).toEqual({ entity: 'productUpdate', payload: { id: 'p1', name: 'Oxford Shirt Slim', gstRate: null } })
    expect(() => updateProduct(s, 'p1', { styleCode: 'ms-101' }, ctx())).not.toThrow() // its own code
  })

  test('an item with history is archived, one without can be deleted', () => {
    let s = baseState()
    s = apply(s, saveBill(s, billInput(s, [line(s.variants.v1)]), ctx()).changes)
    expect(hasHistory(s, 'p1')).toBe(true)
    expect(() => deleteProduct(s, 'p1', ctx())).toThrow('archive')
    const fresh = apply(baseState(), createItem(baseState(), { name: 'X', styleCode: 'X-1', categoryId: 'cat_mshirt', brand: '', fabric: '', season: '', hsn: '', sizes: [''], colors: [''], cost: 1, mrp: 2, price: 2, openingStock: 4 }, ctx()).changes)
    const pid = listOf(fresh.products).find((p) => p.styleCode === 'X-1')!.id
    expect(hasHistory(fresh, pid)).toBe(false)
    const gone = apply(fresh, deleteProduct(fresh, pid, ctx()).changes)
    expect(gone.products[pid]).toBeUndefined()
    expect(listOf(gone.variants).filter((v) => v.productId === pid)).toHaveLength(0)
  })

  test('categories: duplicates and in-use ones are refused', () => {
    const s = baseState()
    expect(() => saveCategory(s, { name: 'shirts', group: 'Men' }, ctx())).toThrow('already')
    expect(() => deleteCategory(s, 'cat_mshirt')).toThrow('still has items')
    expect(deleteCategory(s, 'nothing').changes.del!.categories).toEqual(['nothing'])
  })
})

describe('people', () => {
  test('customers: validates, de-duplicates by mobile, syncs only what changed', () => {
    const s = baseState()
    const d = { name: 'Neha', phone: '9000000001', email: '', dob: '', anniversary: '', address: '', gstin: '', notes: '' }
    expect(() => saveCustomer(s, { ...d, phone: '123' }, undefined, ctx())).toThrow('10-digit')
    expect(() => saveCustomer(s, { ...d, phone: '9876543210' }, undefined, ctx())).toThrow('already uses')
    expect(() => saveCustomer(s, { ...d, email: 'nope' }, undefined, ctx())).toThrow('email')
    const made = saveCustomer(s, d, undefined, ctx())
    expect(made.changes.outbox![0].entity).toBe('customer')
    const edit = saveCustomer(apply(s, made.changes), { ...d, name: 'Neha Rao' }, made.customer.id, ctx())
    expect(edit.changes.outbox![0]).toEqual({ entity: 'customerUpdate', payload: { id: made.customer.id, name: 'Neha Rao' } })
  })

  test('suppliers: unique names, GSTIN length', () => {
    const s = baseState()
    expect(() => saveSupplier(s, { name: 'fab mills', phone: '', gstin: '', address: '', openingBalance: 0 }, undefined, ctx())).toThrow('already')
    expect(() => saveSupplier(s, { name: 'New', phone: '', gstin: 'ABC', address: '', openingBalance: 0 }, undefined, ctx())).toThrow('15')
  })

  test('staff: the last owner cannot be demoted; the PIN goes up once, plain, and is never stored', () => {
    const s = baseState()
    expect(() => saveStaff(s, { name: 'Asha', role: 'manager', active: true, code: '01' }, owner.id, {}, ctx())).toThrow('at least one active owner')
    const made = saveStaff(s, { name: 'Dev', role: 'manager', active: true, code: '03' }, undefined, { plain: '4321' }, ctx())
    expect(made.user).not.toHaveProperty('pin')
    expect((made.changes.outbox![0].payload as { pin: string }).pin).toBe('4321')
    expect(() => saveStaff(s, { name: 'Dup', role: 'cashier', active: true, code: '02' }, undefined, {}, ctx())).toThrow('already taken')
  })

  test('coupons: percentage cap and unique codes', () => {
    const s = baseState()
    expect(() => saveCoupon(s, { code: 'x', type: 'pct', value: 150, minBill: 0, maxUses: 0, active: true }, undefined, ctx())).toThrow('100')
    const a = saveCoupon(s, { code: 'diwali 10', type: 'pct', value: 10, minBill: 500, maxUses: 0, active: true }, undefined, ctx())
    expect(a.coupon.code).toBe('DIWALI10')
    expect(() => saveCoupon(apply(s, a.changes), { code: 'DIWALI10', type: 'amt', value: 50, minBill: 0, maxUses: 0, active: true }, undefined, ctx())).toThrow('already exists')
  })
})

describe('money', () => {
  test('expense + day close: expected cash = opening + cash sales − cash expenses', () => {
    let s = baseState()
    const open = openDay(s, 1000, ctx({ now: NOW - 3600_000 }))
    s = apply(s, open.changes)
    expect(() => openDay(s, 0, ctx())).toThrow('already open')
    const bill = saveBill(s, billInput(s, [line(s.variants.v1)]), ctx())
    s = apply(s, bill.changes)
    s = apply(s, addExpense({ date: NOW, category: 'Tea & Snacks', amount: 150, mode: 'cash', vendor: '', note: '', recurring: false }, ctx()).changes)
    const closed = closeDay(s, open.session.id, 1800, ctx({ now: NOW + 1000 }))
    expect(closed.session.expectedCash).toBe(1000 + bill.bill.total - 150)
    expect(closed.session.variance).toBe(1800 - closed.session.expectedCash!)
    expect(closed.changes.outbox!.map((o) => o.entity)).toEqual(['sessionUpdate'])
  })

  test('expense needs an amount', () => {
    expect(() => addExpense({ date: NOW, category: 'Rent', amount: 0, mode: 'cash', vendor: '', note: '', recurring: false }, ctx())).toThrow('amount')
  })

  test('settings: only server-side fields sync', () => {
    const c = updateSettings({ name: 'New Name' }, ctx())
    expect(c.outbox).toEqual([{ entity: 'storeUpdate', payload: { name: 'New Name' } }])
    expect(updateSettings({}, ctx())).toEqual({})
  })
})

describe('state helpers', () => {
  test('applyChanges copies only what changed', () => {
    const s = baseState()
    const next = applyChanges(s, { put: { customers: [customer({ id: 'c2', phone: '9111111111' })] } })
    expect(next.variants).toBe(s.variants)
    expect(next.customers).not.toBe(s.customers)
    expect(Object.keys(next.customers)).toEqual(['c1', 'c2'])
  })
  test('mergeChanges keeps order and drops records deleted in the same batch', () => {
    const a = { put: { customers: [customer()] }, outbox: [{ entity: 'customer' as const, payload: 1 }] }
    const b = { del: { customers: ['c1'] }, outbox: [{ entity: 'customerUpdate' as const, payload: 2 }] }
    const m = mergeChanges(a, b)
    expect(m.put!.customers).toEqual([])
    expect(m.del!.customers).toEqual(['c1'])
    expect(m.outbox!.map((o) => o.payload)).toEqual([1, 2])
  })
})

void variant; void owner
