import { it } from 'vitest'
import * as S from '@/api/schemas'
import { seedBusiness } from '../seed'
import { live } from './helpers'

it('landed cost and debit notes answer as the client expects', async () => {
  const { baseUrl, platformToken } = live()
  const s = await seedBusiness(baseUrl, platformToken, { prefix: 'lc' })
  const out: Record<string, unknown> = {}
  const c = s.company.id; const d = new Date().toISOString().slice(0, 10)
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as { id: string; code: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  const po = await s.call('POST', '/v1/purchasing/orders', { companyId: c, gstRegistrationId: s.registration.id, supplierId: s.supplier.id, orderDate: d, lines: [{ itemId: s.widget.id, quantity: '10', unitPrice: '100' }] })
  const poFull = await s.call('GET', `/v1/purchasing/orders/${po.id}`) as unknown as { lines: { id: string }[] }
  const gr = await s.call('POST', '/v1/purchasing/receipts', { companyId: c, supplierId: s.supplier.id, purchaseOrderId: po.id, receiptDate: d, lines: [{ orderLineId: poFull.lines[0]!.id, warehouseId: s.warehouse.id, quantity: '10' }] }).catch((e: Error) => e.message)
  out['gr'] = gr
  const grGet = typeof gr === 'string' ? null : await s.call('GET', `/v1/purchasing/receipts/${(gr as { id: string }).id}`)
  out['grGet'] = grGet
  const lineId = (grGet as unknown as { lines: { id: string }[] }).lines[0]!.id
  out['lc'] = await s.call('POST', '/v1/purchasing/landed-costs', { companyId: c, voucherDate: d, description: 'Freight', basis: 'value', charges: [{ kind: 'freight', amount: '500', accountId: a('5900') }], receiptLines: [lineId] }).catch((e: Error) => e.message)
  out['lcs'] = await s.call('GET', `/v1/purchasing/landed-costs?companyId=${c}`)
  const bill = await s.call('POST', '/v1/purchasing/bills', { companyId: c, gstRegistrationId: s.registration.id, supplierId: s.supplier.id, supplierInvoiceNo: 'V1', supplierInvoiceDate: d, billDate: d, lines: [{ itemId: s.widget.id, quantity: '10', unitPrice: '100', grnLineId: lineId }] }) as unknown as { id: string; lines: { id: string }[] }
  out['dn'] = await s.call('POST', '/v1/purchasing/debit-notes', { originalBillId: bill.id, noteDate: d, reason: 'Damaged', lines: [{ originalLineId: bill.lines[0]!.id, quantity: '2' }] }).catch((e: Error) => e.message)
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, v: unknown, what: string) => { const r = schema.safeParse(v); if (!r.success) throw new Error(`${what}: ${JSON.stringify((r.error as { issues: unknown }).issues).slice(0, 600)}`) }
  ok(S.landedCost, out['lc'], 'landed cost'); ok(S.page(S.landedCostHeader), out['lcs'], 'landed costs'); ok(S.bill, out['dn'], 'debit note'); ok(S.goodsReceipt, out['grGet'], 'receipt')
})
