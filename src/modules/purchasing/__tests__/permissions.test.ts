import { NOW } from '@/data/__tests__/helpers'
import { actorWith, rig } from '@/replication/testkit'
import { purchasingState } from './helpers'

/** Every purchasing collection refuses a client without the `purchases` permission (a till operator can sell, not buy). */
describe('purchasing collections refuse a client without the permission', () => {
  const docs: Array<[string, Record<string, unknown>]> = [
    ['supplierPayments', { supplierId: 's1', amount: 100, allocations: [], mode: 'cash' }],
    ['purchaseInvoices', { supplierId: 's1', lines: [{}], total: 100, payable: 100 }],
    ['purchaseReturns', { supplierId: 's1', items: [{}], total: 100, refund: 0 }],
    ['landedCosts', { purchaseId: 'p1', lines: [{}], total: 100 }],
    ['supplierPrices', { supplierId: 's1', variantId: 'v1', price: 10, minQty: 1 }],
    ['rfqs', { items: [], supplierIds: ['s1'] }],
    ['rfqQuotes', { rfqId: 'r1', supplierId: 's1', prices: { v1: 10 } }],
    ['supplierTerms', { supplierId: 's1', creditDays: 30 }],
  ]
  test.each(docs)('%s', async (coll, body) => {
    const r = rig(purchasingState())
    await r.seed()
    const cashier = actorWith(['pos', 'customers'], 'u_cash')
    const data = { id: 'x1', ...body }
    const res = await r.send([{ mid: 'm1', coll, id: 'x1', op: 'create', data, at: NOW }], cashier).catch((e: Error) => e)
    expect(String(res instanceof Error ? res.message : JSON.stringify(res))).toMatch(/refused|rejected|permission/i)
    expect(((await r.serverView()) as unknown as Record<string, Record<string, unknown>>)[coll]?.x1).toBeUndefined()
  })
})
