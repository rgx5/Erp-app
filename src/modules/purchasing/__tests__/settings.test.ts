import { ctx, NOW } from '@/data/__tests__/helpers'
import { rig, actorWith } from '@/replication/testkit'
import { savePurchaseSettings, saveSupplierTerms } from '../ops-payables'
import { purchasingState } from './helpers'

describe('settings and supplier terms replicate', () => {
  test('server == phone, and settings are the owner’s to change', async () => {
    const r = rig(purchasingState())
    await r.seed()
    await r.run((s) => savePurchaseSettings(s, { approvalsOn: true, limits: { manager: 25_000 }, defaultDays: 21 }, ctx({ now: NOW + 1 })))
    await r.run((s) => saveSupplierTerms(s, 's1', { creditDays: 45, notes: 'pays by the 10th' }, ctx({ now: NOW + 2 })))
    const server = await r.serverView()
    expect(server.purchaseSettings).toEqual(r.phone.purchaseSettings)
    expect(server.supplierTerms).toEqual(r.phone.supplierTerms)
    expect(server.purchaseSettings.purchasing.limits).toEqual({ manager: 25_000 })

    const manager = actorWith(['purchases', 'reports', 'inventory'], 'u_mgr')
    const mut = { mid: 'm1', coll: 'purchaseSettings', id: 'purchasing', op: 'patch' as const, data: { approvalsOn: false }, at: NOW + 5 }
    await expect(r.send([mut], manager)).rejects.toThrow('refused')
  })
})
