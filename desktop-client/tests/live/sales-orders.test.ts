import { it } from 'vitest'
import * as S from '@/api/schemas'
import { seedBusiness } from '../seed'
import { live } from './helpers'

it('quotes and sales orders answer as the client expects', async () => {
  const { baseUrl, platformToken } = live()
  const s = await seedBusiness(baseUrl, platformToken, { prefix: 'qo' })
  const out: Record<string, unknown> = {}
  const c = s.company.id; const d = new Date().toISOString().slice(0, 10); const later = `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`
  const lines = [{ itemId: s.widget.id, quantity: '3', unitPrice: '1000', warehouseId: s.warehouse.id }]
  out['quote'] = await s.call('POST', '/v1/sales/quotes', { companyId: c, gstRegistrationId: s.registration.id, customerId: s.customer.id, quoteDate: d, validUntil: later, notes: 'n', lines })
  out['quotes'] = await s.call('GET', `/v1/sales/quotes?companyId=${c}`)
  out['order'] = await s.call('POST', `/v1/sales/quotes/${(out['quote'] as { id: string }).id}/convert`, { orderDate: d, reserveStock: true })
  out['order2'] = await s.call('POST', '/v1/sales/orders', { companyId: c, gstRegistrationId: s.registration.id, customerId: s.customer.id, orderDate: d, lines })
  out['orders'] = await s.call('GET', `/v1/sales/orders?companyId=${c}`)
  out['orderGet'] = await s.call('GET', `/v1/sales/orders/${(out['order'] as { id: string }).id}`)
  const q2 = await s.call('POST', '/v1/sales/quotes', { companyId: c, gstRegistrationId: s.registration.id, customerId: s.customer.id, quoteDate: d, validUntil: later, lines })
  out['rejected'] = await s.call('POST', `/v1/sales/quotes/${q2.id}/reject`, {})
  out['inv'] = await s.call('POST', `/v1/sales/orders/${(out['order'] as { id: string }).id}/invoice`, { invoiceDate: d, lines: [{ orderLineId: (out['order'] as { lines: { id: string }[] }).lines[0]!.id, quantity: '1' }] })
  out['orderAfter'] = await s.call('GET', `/v1/sales/orders/${(out['order'] as { id: string }).id}`)
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, v: unknown, what: string) => { const r = schema.safeParse(v); if (!r.success) throw new Error(`${what}: ${JSON.stringify((r.error as { issues: unknown }).issues).slice(0, 600)}`) }
  ok(S.quote, out['quote'], 'quote'); ok(S.page(S.quoteHeader), out['quotes'], 'quotes'); ok(S.quote, out['rejected'], 'rejected')
  for (const k of ['order', 'order2', 'orderGet', 'orderAfter']) ok(S.salesOrder, out[k], k)
  ok(S.page(S.orderHeader), out['orders'], 'orders'); ok(S.invoice, out['inv'], 'invoice from order')
})
