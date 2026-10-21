import { listOf } from '@/data/state'
import { rig } from '@/replication/testkit'
import {
  addAttachment, postOpeningStock, applyMinMax, createDraftOrders, deleteCustomField, deleteLabelTemplate, importItems, markUploaded, removeAttachment, saveCatalogSettings, saveCustomField, saveLabelTemplate,
  saveReorderRule, setCustomValues, setPrimaryPhoto,
} from '../ops'
import { reorderPlan } from '../logic'
import { parseCsv } from '../sheet'
import { baseState, ctx, NOW } from './helpers'

const HEAD = 'Item code,Name,Category,Brand,HSN,Unit,GST %,Option 1,Option 2,SKU,Barcode,Cost,MRP,Price,Stock,Reorder level'

describe('the server ends up with exactly what the phone has', () => {
  test('every collection: photos, fields, labels, rules, settings, draft purchase orders and an import', async () => {
    const r = rig(baseState())
    await r.seed()
    let n = 0
    const c = () => ctx({ now: NOW + ++n * 10 })

    const a = await r.run((s) => addAttachment(s, { productId: 'p1', kind: 'photo', name: 'a.jpg', uri: 'file:///a.jpg', mime: 'image/jpeg', size: 10 }, c()))
    const b = await r.run((s) => addAttachment(s, { productId: 'p1', kind: 'photo', name: 'b.jpg', uri: 'file:///b.jpg', mime: 'image/jpeg', size: 10 }, c()))
    await r.run((s) => setPrimaryPhoto(s, b.attachment.id))
    await r.run((s) => markUploaded(s, a.attachment.id, { id: 'f1', url: '/files/f1' }, c()))

    const f = await r.run((s) => saveCustomField(s, { label: 'Grade', type: 'choice', options: ['A', 'B'], required: false, active: true }, undefined, c()))
    const g = await r.run((s) => saveCustomField(s, { label: 'Notes', type: 'text', options: [], required: false, active: true }, undefined, c()))
    await r.run((s) => setCustomValues(s, 'p1', { [f.field.id]: 'A', [g.field.id]: 'hello' }, c()))
    await r.run((s) => deleteCustomField(s, g.field.id, c()))

    const t = await r.run((s) => saveLabelTemplate(s, { name: 'Tag', widthMm: 50, heightMm: 30, perRow: 1, paper: 'roll', fields: ['name', 'price'], code: 'qr', qrText: '{barcode}' }, undefined, c()))
    await r.run((s) => saveCatalogSettings(s, { leadDays: 5, labelTemplateId: t.template.id, defaultSupplierId: 's1' }, c()))
    await r.run((s) => saveReorderRule(s, 'v1', { supplierId: 's1', max: 40, moq: 6 }, c()))
    await r.run((s) => saveReorderRule(s, 'v2', { max: 40 }, c()))
    await r.run((s) => applyMinMax(s, [{ variantId: 'v2', min: 6, max: 30 }], c()))

    const plan = reorderPlan(r.phone, NOW + 1000)
    expect(plan.groups[0].lines.length).toBeGreaterThan(0)
    await r.run((s) => createDraftOrders(s, plan.groups.map((x) => ({ supplierId: x.supplierId, items: x.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, cost: l.cost })) })), c()))

    const imp = await r.run((s) => importItems(s, parseCsv([HEAD, 'KU-1,Kurta,Kurtas,Fab,6104,pc,5,M,Blue,,,450,999,799,10,3', ',,,,,,,,,MS-101-NAV-M,,,,1099,12,'].join('\n')), c(), { fileName: 'x.csv' }))
    await r.run((s) => postOpeningStock(s, imp.openings, c()))

    await r.run((s) => removeAttachment(s, a.attachment.id, c()))
    const t2 = await r.run((s) => saveLabelTemplate(s, { name: 'Gone', widthMm: 40, heightMm: 20, perRow: 1, paper: 'roll', fields: ['name'], code: 'none', qrText: '' }, undefined, c()))
    await r.run((s) => deleteLabelTemplate(s, t2.template.id))

    const server = await r.serverView()
    const phone = r.phone
    for (const coll of ['itemAttachments', 'customFields', 'customFieldValues', 'labelTemplates', 'reorderRules', 'catalogSettings', 'purchaseOrders', 'products', 'variants', 'categories', 'moves'] as const) {
      expect(server[coll]).toEqual(phone[coll])
    }
    expect(listOf(server.purchaseOrders).every((o) => o.status === 'draft')).toBe(true)
    expect(listOf(server.itemAttachments)).toHaveLength(1)
    expect(server.customFieldValues.p1.values).toEqual({ [f.field.id]: 'A' })
    expect(server.variants.v1).toMatchObject({ price: 1099, stock: 12 })
    expect(listOf(server.variants).find((v) => v.sku === 'KU-1-BLU-M')!.stock).toBe(10)
  })
})
