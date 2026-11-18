import { expect, it } from 'vitest'
import * as S from '@/api/schemas'
import { seedBusiness } from '../seed'
import { live } from './helpers'

it('manufacturing answers match what the client expects', async () => {
  const { baseUrl, platformToken } = live()
  const s = await seedBusiness(baseUrl, platformToken, { prefix: 'probe' })
  const out: Record<string, unknown> = {}
  const c = s.company.id; const d = new Date().toISOString().slice(0, 10)
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as { id: string; code: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  out['settings'] = await s.call('PUT', `/v1/manufacturing/companies/${c}/settings`, { wipAccountId: a('1230'), labourAbsorbedAccountId: a('5210'), overheadAbsorbedAccountId: a('5230'), productionVarianceAccountId: a('5260'), subcontractClearingAccountId: a('5240') })
  out['wc'] = await s.call('POST', '/v1/manufacturing/work-centres', { companyId: c, code: 'ASM', name: 'Assembly', labourRatePerHour: '200', machineRatePerHour: '100', overheadRatePerHour: '50' })
  out['wcs'] = await s.call('GET', `/v1/manufacturing/work-centres?companyId=${c}`)
  const bom = await s.call('POST', '/v1/manufacturing/boms', { companyId: c, itemId: s.widget.id, baseQuantity: '1', effectiveFrom: `${s.year}-04-01`, lines: [{ itemId: s.cheap.id, quantity: '2', scrapPercent: '5' }], operations: [{ opNo: 10, name: 'Assemble', workCentreId: (out['wc'] as { id: string }).id, setupHours: '0.5', runHours: '1' }] })
  out['bom'] = bom
  out['boms'] = await s.call('GET', `/v1/manufacturing/boms?companyId=${c}`)
  out['explode'] = await s.call('GET', `/v1/manufacturing/boms/explode?companyId=${c}&itemId=${s.widget.id}&quantity=5&date=${d}`)
  out['rollup'] = await s.call('GET', `/v1/manufacturing/costing/rollup?companyId=${c}&itemId=${s.widget.id}&quantity=1&date=${d}`)
  const wo0 = await s.call('POST', '/v1/manufacturing/work-orders', { companyId: c, itemId: s.widget.id, orderDate: d, plannedQuantity: '10', outputWarehouseId: s.warehouse.id, materialsWarehouseId: s.warehouse.id })
  out['wo0'] = wo0
  const id = (wo0 as { id: string }).id
  out['released'] = await s.call('POST', `/v1/manufacturing/work-orders/${id}/release`, {})
  out['issued'] = await s.call('POST', `/v1/manufacturing/work-orders/${id}/issue-materials`, { date: d, lines: [{ itemId: s.cheap.id, quantity: '21' }] })
  out['time'] = await s.call('POST', `/v1/manufacturing/work-orders/${id}/report-time`, { date: d, lines: [{ opNo: 10, hours: '10' }] })
  out['output'] = await s.call('POST', `/v1/manufacturing/work-orders/${id}/report-output`, { date: d, quantity: '10', scrapQuantity: '1' })
  out['completed'] = await s.call('POST', `/v1/manufacturing/work-orders/${id}/complete`, { date: d })
  out['variance'] = await s.call('GET', `/v1/manufacturing/work-orders/${id}/variance`)
  out['variances'] = await s.call('GET', `/v1/manufacturing/costing/variances?companyId=${c}&from=${s.year}-04-01&to=${d}`)
  out['wip'] = await s.call('GET', `/v1/manufacturing/wip-reconciliation?companyId=${c}&asOf=${d}`)
  out['list'] = await s.call('GET', `/v1/manufacturing/work-orders?companyId=${c}`)
  const jw = await s.call('POST', '/v1/warehouses', { businessLocationId: s.location.id, code: 'JOB', name: 'Job worker', kind: 'subcontractor' })
  const sub = await s.call('POST', '/v1/parties', { code: 'JW-1', legalName: 'Job Works', gstTreatment: 'unregistered', isSupplier: true, isSubcontractor: true })
  const so = await s.call('POST', '/v1/manufacturing/subcontracting/orders', { companyId: c, itemId: s.widget.id, orderDate: d, plannedQuantity: '4', outputWarehouseId: s.warehouse.id, subcontractorId: sub.id, jobWorkerWarehouseId: jw.id, sourceWarehouseId: s.warehouse.id, ratePerUnit: '30' })
  out['so'] = so
  out['soRel'] = await s.call('POST', `/v1/manufacturing/subcontracting/orders/${so.id}/release`, {})
  out['soSend'] = await s.call('POST', `/v1/manufacturing/subcontracting/orders/${so.id}/send`, { date: d, lines: [{ itemId: s.cheap.id, quantity: '9' }] })
  out['soPending'] = await s.call('GET', `/v1/manufacturing/subcontracting/pending?companyId=${c}&asOf=${d}`)
  out['soRecv'] = await s.call('POST', `/v1/manufacturing/subcontracting/orders/${so.id}/receive`, { date: d, quantity: '4' })
  out['soList'] = await s.call('GET', `/v1/manufacturing/subcontracting/orders?companyId=${c}`)
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, v: unknown, what: string) => { const r = schema.safeParse(v); if (!r.success) throw new Error(`${what}: ${JSON.stringify((r.error as { issues: unknown }).issues).slice(0, 600)}`) }
  ok(S.mfgSettings, out['settings'], 'settings'); ok(S.workCentre, out['wc'], 'work centre'); ok(S.page(S.workCentre), out['wcs'], 'work centres')
  ok(S.bom, out['bom'], 'bom'); ok(S.page(S.bomHeader), out['boms'], 'boms'); ok(S.explosion, out['explode'], 'explode'); ok(S.rollup, out['rollup'], 'rollup')
  for (const k of ['wo0', 'released', 'issued', 'time', 'output', 'completed']) ok(S.workOrder, out[k], k)
  ok(S.page(S.workOrderHeader), out['list'], 'list'); ok(S.woVariance, out['variance'], 'variance'); ok(S.variances, out['variances'], 'variances'); ok(S.wipReconciliation, out['wip'], 'wip')
  for (const k of ['so', 'soRel', 'soSend', 'soRecv']) ok(S.subcontractOrder, out[k], k)
  ok(S.subcontractPending, out['soPending'], 'pending'); ok(S.page(S.subcontractHeader), out['soList'], 'sub list')
  expect((out['variance'] as { totals: { variancePercent: string } }).totals.variancePercent).toMatch(/^-?\d+\.\d{4}$/)
})
