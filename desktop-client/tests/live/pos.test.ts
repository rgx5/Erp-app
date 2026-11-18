import { it } from 'vitest'
import * as S from '@/api/schemas'
import { seedBusiness } from '../seed'
import { live } from './helpers'

it('point of sale answers match what the client expects', async () => {
  const { baseUrl, platformToken } = live()
  const s = await seedBusiness(baseUrl, platformToken, { prefix: 'pos' })
  const out: Record<string, unknown> = {}
  const c = s.company.id
  const d = new Date().toISOString().slice(0, 10)
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as { id: string; code: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  out['settings0'] = await s.call('GET', `/v1/pos/settings?companyId=${c}`)
  out['put'] = await s.call('PUT', `/v1/pos/settings?companyId=${c}`, { walkInCustomerId: s.walkIn.id, cashVarianceAccountId: a('5900') })
  for (const [m, code] of [['cash', '1110'], ['upi', '1120'], ['card', '1120'], ['bank_transfer', '1120'], ['cheque', '1120'], ['other', '1120']]) out['map_' + m] = await s.call('PUT', `/v1/pos/payment-accounts?companyId=${c}`, { method: m, accountId: a(code as string) })
  out['settings'] = await s.call('GET', `/v1/pos/settings?companyId=${c}`)
  out['terminal'] = await s.call('POST', '/v1/pos/terminals', { companyId: c, code: 'T1', name: 'Counter 1', gstRegistrationId: s.registration.id, businessLocationId: s.location.id, warehouseId: s.warehouse.id })
  const tid = (out['terminal'] as { id: string }).id
  out['terminals'] = await s.call('GET', `/v1/pos/terminals?companyId=${c}`)
  out['shift'] = await s.call('POST', '/v1/pos/shifts', { terminalId: tid, openingCash: '500' })
  const sid = (out['shift'] as { id: string }).id
  out['sale'] = await s.call('POST', '/v1/pos/sales', { shiftId: sid, lines: [{ itemId: s.widget.id, quantity: '2', unitPrice: '1180' }, { itemId: s.cheap.id, quantity: '1', unitPrice: '105', discountPercent: '10' }], payments: [{ method: 'cash', amount: '1000', tendered: '1000' }, { method: 'upi', amount: '1455' }] }).catch((e: Error) => e.message)
  out['sales'] = await s.call('GET', `/v1/pos/sales?companyId=${c}&shiftId=${sid}`)
  out['shiftNow'] = await s.call('GET', `/v1/pos/shifts/${sid}`)
  const sale = out['sale'] as { id: string; invoice: { lines: { id: string; lineNo: number }[] } }
  out['saleDetail'] = await s.call('GET', `/v1/pos/sales/${sale.id}`)
  out['return'] = await s.call('POST', '/v1/pos/returns', { shiftId: sid, originalSaleId: sale.id, reason: 'Wrong size', lines: [{ originalLineId: sale.invoice.lines[1]!.id, quantity: '1' }], refunds: [{ method: 'cash', amount: '95' }] }).catch((e: Error) => e.message)
  out['calc'] = await s.call('POST', '/v1/sales/invoices/calculate', { companyId: c, gstRegistrationId: s.registration.id, customerId: s.walkIn.id, invoiceDate: d, lines: [{ itemId: s.widget.id, quantity: '2', unitPrice: '1180', taxInclusive: true }, { itemId: s.cheap.id, quantity: '1', unitPrice: '105', discountPercent: '10', taxInclusive: true }] })
  out['device'] = await s.call('POST', '/v1/pos/devices', { terminalId: tid, name: 'Counter PC' })
  out['catalogue'] = await s.call('GET', `/v1/pos/sync/catalogue?deviceId=${(out['device'] as { id: string }).id}`)
  const dev = (out['device'] as { id: string }).id
  out['sync'] = await s.call('POST', '/v1/pos/sync/batches', { deviceId: dev, shiftId: sid, items: [{ clientId: crypto.randomUUID(), kind: 'sale', occurredAt: new Date().toISOString(), payload: { lines: [{ itemId: s.cheap.id, quantity: '1', unitPrice: '105' }], payments: [{ method: 'cash', amount: '105' }] } }] }).catch((e: Error) => e.message)
  out['close'] = await s.call('POST', `/v1/pos/shifts/${sid}/close`, { countedCash: '1500' }).catch((e: Error) => e.message)
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, v: unknown, what: string) => { const r = schema.safeParse(v); if (!r.success) throw new Error(`${what}: ${JSON.stringify((r.error as { issues: unknown }).issues).slice(0, 700)}`) }
  ok(S.posSettings, out['settings'], 'settings'); ok(S.posTerminal, out['terminal'], 'terminal'); ok(S.posShift, out['shift'], 'shift'); ok(S.posShift, out['shiftNow'], 'shift with summary'); ok(S.posShift, out['close'], 'closed shift')
  ok(S.posSaleResult, out['sale'], 'sale'); ok(S.posSaleResult, out['return'], 'return'); ok(S.page(S.posSaleHeader), out['sales'], 'sales'); ok(S.posSaleDetail, out['saleDetail'], 'sale detail')
  ok(S.posDevice, out['device'], 'device'); ok(S.posCatalogue, out['catalogue'], 'catalogue'); ok(S.syncResult, out['sync'], 'sync'); ok(S.calculation, out['calc'], 'calc')
})
