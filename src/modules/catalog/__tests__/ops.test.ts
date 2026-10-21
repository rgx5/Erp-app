import { applyChanges, listOf } from '@/data/state'
import { OpError } from '@/data/ops'
import { actorWith, rig } from '@/replication/testkit'
import {
  addAttachment, applyMinMax, deleteCustomField, deleteLabelTemplate, markUploaded, removeAttachment, saveCatalogSettings, saveCustomField, saveLabelTemplate,
  saveReorderRule, setCustomValues, setPrimaryPhoto,
} from '../ops'
import { LABEL_PRESETS, allTemplates, findTemplate, labelSheetHtml, qrPayload, templateProblem } from '../labels'
import { fileUrl, needsUpload, uploadAttachment } from '../upload'
import { formatFieldValue, missingRequired, parseFieldValue } from '../fields'
import { baseState, ctx, NOW, tradingState } from './helpers'

const photo = { productId: 'p1', kind: 'photo' as const, name: 'front.jpg', uri: 'file:///a/front.jpg', mime: 'image/jpeg', size: 1000 }

describe('custom fields', () => {
  test('definitions, values by type, required and choices', () => {
    let s = baseState()
    const mk = (d: Parameters<typeof saveCustomField>[1]) => { const r = saveCustomField(s, d, undefined, ctx()); s = applyChanges(s, r.changes); return r.field }
    const warranty = mk({ label: 'Warranty months', type: 'number', options: [], required: false, active: true })
    const grade = mk({ label: 'Grade', type: 'choice', options: ['A', 'B', ' A ', ''], required: true, active: true })
    mk({ label: 'Fragile', type: 'yesno', options: ['ignored'], required: false, active: true })
    expect(grade.options).toEqual(['A', 'B'])
    expect(() => saveCustomField(s, { label: 'warranty months', type: 'text', options: [], required: false, active: true }, undefined, ctx())).toThrow('already')
    expect(() => saveCustomField(s, { label: 'Size', type: 'choice', options: ['one'], required: false, active: true }, undefined, ctx())).toThrow('two choices')

    expect(() => setCustomValues(s, 'p1', { [warranty.id]: 'abc' }, ctx())).toThrow('must be a number')
    expect(() => setCustomValues(s, 'p1', { [grade.id]: 'Z' }, ctx())).toThrow('one of')
    expect(() => setCustomValues(s, 'p1', { [grade.id]: '' }, ctx())).toThrow('required')
    s = applyChanges(s, setCustomValues(s, 'p1', { [warranty.id]: '24', [grade.id]: 'b' }, ctx()).changes)
    expect(s.customFieldValues.p1.values).toEqual({ [warranty.id]: 24, [grade.id]: 'B' })
    expect(setCustomValues(s, 'p1', { [warranty.id]: '24' }, ctx()).changes).toEqual({})
    expect(missingRequired(listOf(s.customFields), s.customFieldValues.p1)).toEqual([])
    expect(() => saveCustomField(s, { label: 'Warranty months', type: 'text', options: [], required: false, active: true }, warranty.id, ctx())).toThrow('cannot change')

    s = applyChanges(s, deleteCustomField(s, warranty.id, ctx()).changes)
    expect(s.customFields[warranty.id]).toBeUndefined()
    expect(s.customFieldValues.p1.values).toEqual({ [grade.id]: 'B' })
  })

  test('parse and show values', () => {
    expect(parseFieldValue({ label: 'D', type: 'date', options: [] }, '2026-02-30').error).toBeUndefined() // JS rolls the day over; format is what is checked
    expect(parseFieldValue({ label: 'D', type: 'date', options: [] }, '20/10/2026').error).toMatch(/YYYY-MM-DD/)
    expect(parseFieldValue({ label: 'Y', type: 'yesno', options: [] }, 'Yes').value).toBe(true)
    expect(formatFieldValue({ type: 'yesno' }, false)).toBe('No')
    expect(formatFieldValue({ type: 'date' }, '2026-10-19')).toMatch(/2026/)
  })
})

describe('photos and attachments', () => {
  test('the first photo is the main one; removing it promotes the next; uploads are recorded', () => {
    let s = baseState()
    const a = addAttachment(s, photo, ctx({ now: NOW + 1 })); s = applyChanges(s, a.changes)
    const b = addAttachment(s, { ...photo, name: 'back.jpg', uri: 'file:///a/back.jpg' }, ctx({ now: NOW + 2 })); s = applyChanges(s, b.changes)
    const doc = addAttachment(s, { ...photo, kind: 'file', name: 'spec: v2?.pdf', mime: 'application/pdf' }, ctx({ now: NOW + 3 })); s = applyChanges(s, doc.changes)
    expect([a.attachment.primary, b.attachment.primary, doc.attachment.primary]).toEqual([true, undefined, undefined])
    expect(doc.attachment.name).toBe('spec- v2-.pdf')
    s = applyChanges(s, setPrimaryPhoto(s, b.attachment.id).changes)
    expect(s.itemAttachments[a.attachment.id].primary).toBe(false)
    expect(s.itemAttachments[b.attachment.id].primary).toBe(true)
    expect(() => setPrimaryPhoto(s, doc.attachment.id)).toThrow('photo')
    const gone = removeAttachment(s, b.attachment.id, ctx()); s = applyChanges(s, gone.changes)
    expect(gone.removed.uri).toBe('file:///a/back.jpg')
    expect(s.itemAttachments[a.attachment.id].primary).toBe(true)
    expect(needsUpload(s.itemAttachments[a.attachment.id])).toBe(true)
    s = applyChanges(s, markUploaded(s, a.attachment.id, { id: 'f1', url: '/files/f1' }, ctx()).changes)
    expect(needsUpload(s.itemAttachments[a.attachment.id])).toBe(false)
    expect(() => addAttachment(s, { ...photo, productId: 'nope' }, ctx())).toThrow('no longer')
  })

  test('upload: posts raw bytes to /files with the sign-in, and says why it failed', async () => {
    const calls: Array<{ url: string; init: { headers: Record<string, string>; body: Uint8Array } }> = []
    const deps = {
      baseUrl: 'https://kosh.example/', token: () => 'tok', read: async () => new Uint8Array([1, 2, 3]),
      fetch: async (url: string, init: { method: string; headers: Record<string, string>; body: Uint8Array }) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '{"id":"f9","url":"/files/f9","size":3}' } },
    }
    const r = await uploadAttachment({ uri: 'file:///x.jpg', name: 'frönt.jpg', mime: 'image/jpeg', size: 3 }, deps)
    expect(r).toEqual({ id: 'f9', url: '/files/f9', size: 3 })
    expect(calls[0].url).toBe('https://kosh.example/files')
    expect(calls[0].init.headers).toMatchObject({ 'Content-Type': 'image/jpeg', Authorization: 'Bearer tok', 'X-Filename': 'fr_nt.jpg' })
    expect(fileUrl('https://kosh.example/', { remoteUrl: '/files/f9' })).toBe('https://kosh.example/files/f9')
    expect(fileUrl('https://kosh.example', { remoteId: 'f9' })).toBe('https://kosh.example/files/f9')
    expect(fileUrl('https://kosh.example', {})).toBeNull()
    await expect(uploadAttachment({ uri: 'x', name: 'x', mime: '', size: 11 * 1024 * 1024 }, deps)).rejects.toThrow('10 MB')
    await expect(uploadAttachment({ uri: 'x', name: 'x', mime: '', size: 1 }, { ...deps, token: () => null })).rejects.toThrow('Sign in')
    await expect(uploadAttachment({ uri: 'x', name: 'x', mime: '', size: 1 }, { ...deps, fetch: async () => ({ ok: false, status: 413, text: async () => '{"error":"Too big"}' }) })).rejects.toThrow('Too big')
    await expect(uploadAttachment({ uri: 'x', name: 'x', mime: '', size: 1 }, { ...deps, fetch: async () => { throw new Error('net') } })).rejects.toThrow('Cannot reach')
  })
})

describe('label templates', () => {
  const item = { name: 'Oxford <Shirt>', variant: 'M / Navy', sku: 'MS-1', barcode: '2100000000015', price: 999, mrp: 1299, copies: 2, brand: 'Acme', hsn: '6205' }

  test('presets render bars or a QR, escape text and repeat per copy', () => {
    const bars = labelSheetHtml([item], LABEL_PRESETS[0], 'My Shop')
    expect(bars).toContain('Oxford &lt;Shirt&gt;')
    expect(bars.match(/class="l"/g)).toHaveLength(2)
    expect(bars).toContain('<svg')
    expect(bars).toContain('MRP')
    const qr = labelSheetHtml([item], findTemplate([], 'preset:qr'), 'My Shop')
    expect(qr).toContain('class="l row"')
    expect(qr).toContain('class="q"')
    expect(qr).toContain('size:50mm 30mm')
    expect(qr).not.toContain('My Shop')
    expect(qrPayload({ qrText: 'item:{sku}|{price}' }, item)).toBe('item:MS-1|999')
    expect(labelSheetHtml([item], { ...LABEL_PRESETS[0], code: 'none', fields: ['name'] }, '')).not.toContain('<svg')
  })

  test('validation, saving and deleting', () => {
    let s = baseState()
    const draft = { name: 'Jewellery tag', widthMm: 50, heightMm: 15, perRow: 4, paper: 'sheet' as const, fields: ['sku' as const, 'price' as const], code: 'qr' as const, qrText: '{sku}' }
    expect(templateProblem({ ...draft, widthMm: 10 })).toMatch(/width/)
    expect(templateProblem({ ...draft, perRow: 5 })).toMatch(/do not fit/)
    expect(templateProblem({ ...draft, name: ' ' })).toMatch(/name/)
    expect(() => saveLabelTemplate(s, { ...draft, heightMm: 5 }, undefined, ctx())).toThrow(OpError)
    const t = saveLabelTemplate(s, draft, undefined, ctx()); s = applyChanges(s, t.changes)
    expect(() => saveLabelTemplate(s, { ...draft, name: 'jewellery TAG' }, undefined, ctx())).toThrow('already')
    expect(allTemplates(listOf(s.labelTemplates)).map((x) => x.id)).toContain(t.template.id)
    s = applyChanges(s, saveCatalogSettings(s, { labelTemplateId: t.template.id }, ctx()).changes)
    s = applyChanges(s, deleteLabelTemplate(s, t.template.id).changes)
    expect(s.labelTemplates[t.template.id]).toBeUndefined()
    expect(s.catalogSettings.catalog.labelTemplateId).toBeUndefined()
  })
})

describe('min-max', () => {
  test('applying sets the reorder level and the order-up-to level, keeping other rule fields', () => {
    let s = tradingState()
    s = applyChanges(s, saveReorderRule(s, 'v1', { supplierId: 's1', min: 9, moq: 6 }, ctx()).changes)
    const r = applyMinMax(s, [{ variantId: 'v1', min: 20, max: 48 }], ctx())
    s = applyChanges(s, r.changes)
    expect(r.count).toBe(1)
    expect(s.variants.v1.reorderLevel).toBe(20)
    expect(s.reorderRules.v1).toEqual({ id: 'v1', variantId: 'v1', supplierId: 's1', moq: 6, max: 48 })
    expect(() => applyMinMax(s, [{ variantId: 'v1', min: 5, max: 5 }], ctx())).toThrow('do not make sense')
    // clearing a rule removes it
    s = applyChanges(s, saveReorderRule(s, 'v1', {}, ctx()).changes)
    expect(s.reorderRules.v1).toBeUndefined()
  })
})

describe('permissions', () => {
  test('a cashier cannot change the catalog or create orders; everyone signed in can read photos and fields', async () => {
    const r = rig(baseState())
    await r.seed()
    const att = await r.run((s) => addAttachment(s, photo, ctx({ now: NOW + 5 })))
    const cash = actorWith(['pos', 'customers'], 'u_cash')
    const muts = [{ mid: 'c:1', coll: 'itemAttachments', id: 'x', op: 'create' as const, data: { id: 'x', productId: 'p1', uri: 'u', kind: 'photo' }, at: 1 }, { mid: 'c:2', coll: 'purchaseOrders', id: 'y', op: 'create' as const, data: { id: 'y', supplierId: 's1', items: [] }, at: 1 }]
    const res = await r.send(muts, cash).catch((e: Error) => e.message)
    expect(String(res)).toMatch(/forbidden/)
    expect((await r.serverView(cash)).itemAttachments[att.attachment.id]).toBeDefined()
    expect((await r.serverView(cash)).reorderRules).toEqual({})
  })
})
