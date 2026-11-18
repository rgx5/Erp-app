import { it } from 'vitest'
import * as S from '@/api/schemas'
import { seedBusiness } from '../seed'
import { live } from './helpers'

it('batches, serials and reservations answer as the client expects', async () => {
  const { baseUrl, platformToken } = live()
  const s = await seedBusiness(baseUrl, platformToken, { prefix: 'trk' })
  const out: Record<string, unknown> = {}
  const c = s.company.id; const d = new Date().toISOString().slice(0, 10)
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const tax = ((await s.call('GET', '/v1/tax-codes?limit=50')).items as { id: string; code: string }[]).find((t) => t.code === 'GST18') as { id: string }
  const milk = await s.call('POST', '/v1/items', { code: 'MILK', name: 'Milk', baseUomId: nos.id, itemType: 'finished_good', taxCodeId: tax.id, hsnSacCode: '0401', tracking: 'batch' })
  const phone = await s.call('POST', '/v1/items', { code: 'PHONE', name: 'Phone', baseUomId: nos.id, itemType: 'finished_good', taxCodeId: tax.id, hsnSacCode: '8517', tracking: 'serial' })
  out['batch'] = await s.call('POST', `/v1/items/${milk.id}/batches`, { batchNo: 'B1', manufactureDate: d, expiryDate: `${Number(d.slice(0, 4)) + 1}${d.slice(4)}` })
  out['batches'] = await s.call('GET', `/v1/items/${milk.id}/batches`)
  await s.call('POST', '/v1/stock/movements', { companyId: c, movementType: 'opening', postingDate: d, description: 'Opening', lines: [{ warehouseId: s.warehouse.id, itemId: milk.id, quantity: '20', unitCost: '30', batchId: (out['batch'] as { id: string }).id }, { warehouseId: s.warehouse.id, itemId: phone.id, quantity: '2', unitCost: '9000', serialNos: ['SN1', 'SN2'] }] })
  out['serials'] = await s.call('GET', `/v1/stock/serials?companyId=${c}&itemId=${phone.id}`)
  out['res'] = await s.call('POST', '/v1/stock/reservations', { companyId: c, warehouseId: s.warehouse.id, itemId: milk.id, batchId: (out['batch'] as { id: string }).id, quantity: '5', referenceType: 'sales_order', referenceId: 'SO-1' })
  out['reservations'] = await s.call('GET', `/v1/stock/reservations?companyId=${c}`)
  out['avail'] = await s.call('GET', `/v1/stock/availability?companyId=${c}&itemId=${milk.id}`)
  out['settings'] = await s.call('GET', `/v1/companies/${c}/stock-settings`)
  out['invmap'] = await s.call('GET', `/v1/companies/${c}/inventory-accounts`)
  out['blocked'] = await s.call('POST', `/v1/batches/${(out['batch'] as { id: string }).id}/status`, { status: 'blocked' })
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, v: unknown, what: string) => { const r = schema.safeParse(v); if (!r.success) throw new Error(`${what}: ${JSON.stringify((r.error as { issues: unknown }).issues).slice(0, 600)}`) }
  ok(S.batch, out['batch'], 'batch'); ok(S.page(S.batch), out['batches'], 'batches'); ok(S.page(S.serial), out['serials'], 'serials'); ok(S.reservation, out['res'], 'reservation'); ok(S.page(S.reservation), out['reservations'], 'reservations')
  ok(S.availability, out['avail'], 'availability'); ok(S.stockSettings, out['settings'], 'settings'); ok(S.batch, out['blocked'], 'blocked batch')
})
