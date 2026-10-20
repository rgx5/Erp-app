import { applyChanges, listOf } from '@/data/state'
import {
  addOpeningBatch, adjustBatch, createBundle, deleteUnitConversion, registerSerial, saveItemRule, saveLocation, saveUnitConversion, setLocationActive, setLocationStock, setSerialStatus, updateBundle,
} from '../ops'
import { batchId, serialId } from '../logic'
import { ctx, NOW, warehouseState } from './helpers'

describe('locations', () => {
  test('names are required, unique, and “Main” is reserved', () => {
    const s = warehouseState()
    expect(() => saveLocation(s, { name: ' ', type: 'shelf' }, undefined, ctx())).toThrow('name')
    expect(() => saveLocation(s, { name: 'main', type: 'shelf' }, undefined, ctx())).toThrow('built-in')
    expect(() => saveLocation(s, { name: 'godown', type: 'shelf' }, undefined, ctx())).toThrow('already')
    expect(() => saveLocation(s, { name: 'X', type: 'shelf', parentId: 'zzz' }, undefined, ctx())).toThrow('parent')
    expect(() => saveLocation(s, { name: 'Godown', type: 'warehouse', parentId: 'locB' }, 'locA', ctx())).toThrow('inside itself')
    const r = saveLocation(s, { name: 'Back room', type: 'shelf', parentId: 'locA' }, undefined, ctx())
    expect(r.location).toMatchObject({ name: 'Back room', parentId: 'locA', active: true })
    expect(r.changes.put?.audit).toHaveLength(1)
  })

  test('a location holding stock cannot be switched off', () => {
    let s = warehouseState()
    s = applyChanges(s, setLocationStock(s, { variantId: 'v1', locationId: 'locA', qty: 2 }, ctx()).changes)
    expect(() => setLocationActive(s, 'locA', false, ctx())).toThrow('Move the stock')
    s = applyChanges(s, setLocationStock(s, { variantId: 'v1', locationId: 'locA', qty: 0 }, ctx()).changes)
    expect(s.variants.v1.stock).toBe(10)
    s = applyChanges(s, setLocationActive(s, 'locA', false, ctx()).changes)
    expect(s.locations.locA.active).toBe(false)
    expect(() => setLocationStock(s, { variantId: 'v1', locationId: 'locA', qty: 1 }, ctx())).toThrow('switched off')
  })

  test('counting rules', () => {
    const s = warehouseState()
    expect(() => setLocationStock(s, { variantId: 'v1', locationId: 'main', qty: 1 }, ctx())).toThrow('Main')
    expect(() => setLocationStock(s, { variantId: 'v1', locationId: 'locA', qty: -1 }, ctx())).toThrow('0 or more')
    expect(() => setLocationStock(s, { variantId: 'v1', locationId: 'locA', qty: 0 }, ctx())).toThrow('already')
  })
})

describe('batches', () => {
  test('an opening batch does not change the item’s total', () => {
    let s = warehouseState()
    s.variants.v3 = { ...s.variants.v3, stock: 30 }
    const r = addOpeningBatch(s, { variantId: 'v3', batchNo: ' ab-1 ', qty: 12, expiry: NOW + 864e5 * 90, cost: 2 }, ctx())
    s = applyChanges(s, r.changes)
    expect(r.batchId).toBe(batchId('v3', 'AB-1'))
    expect(s.batches[r.batchId]).toMatchObject({ batchNo: 'AB-1', qty: 12, cost: 2 })
    expect(s.variants.v3.stock).toBe(30)
    expect(() => addOpeningBatch(s, { variantId: 'v3', batchNo: '', qty: 1 }, ctx())).toThrow('batch number')
    expect(() => addOpeningBatch(s, { variantId: 'v3', batchNo: 'x', qty: 0 }, ctx())).toThrow('how many')
    expect(() => addOpeningBatch(s, { variantId: 'v3', batchNo: 'x', qty: 1, mfgDate: NOW, expiry: NOW - 1 }, ctx())).toThrow('before')
    s = applyChanges(s, adjustBatch(s, r.batchId, -2, 'count', ctx()).changes)
    expect(s.batches[r.batchId].qty).toBe(10)
    expect(() => adjustBatch(s, r.batchId, -11, 'x', ctx())).toThrow('below zero')
    expect(listOf(s.batchMoves).map((m) => m.reason)).toEqual(['opening', 'adjust'])
  })
})

describe('tracking rules and unit conversions', () => {
  test('rules switch on and off; an empty rule is removed', () => {
    let s = warehouseState()
    s = applyChanges(s, saveItemRule(s, 'p1', { trackBatch: true }, ctx()).changes)
    expect(s.itemRules.p1.trackBatch).toBe(true)
    expect(() => saveItemRule(s, 'p1', { warrantyMonths: 1.5 }, ctx())).toThrow('whole number')
    expect(() => saveItemRule(s, 'nope', {}, ctx())).toThrow('no longer')
    const off = saveItemRule(s, 'p1', { trackBatch: false }, ctx())
    expect(off.changes.del?.itemRules).toEqual(['p1'])
  })

  test('conversions: factor above one, one per unit name', () => {
    let s = warehouseState()
    expect(() => saveUnitConversion(s, { productId: 'p1', unit: 'carton', factor: 1 }, undefined, ctx())).toThrow('more than one')
    expect(() => saveUnitConversion(s, { productId: 'p1', unit: ' BOX ', factor: 6 }, undefined, ctx())).toThrow('already set up')
    const r = saveUnitConversion(s, { productId: 'p1', unit: 'Carton', factor: 48, price: 38000 }, undefined, ctx())
    s = applyChanges(s, r.changes)
    expect(r.conversion).toMatchObject({ unit: 'carton', factor: 48, price: 38000 })
    s = applyChanges(s, { del: { unitConversions: [r.conversion.id] } })
    expect(() => deleteUnitConversion(s, r.conversion.id, ctx())).toThrow('no longer')
  })
})

describe('serials', () => {
  test('a returned unit can be put back on the shelf and registered again', () => {
    let s = warehouseState()
    s = applyChanges(s, registerSerial(s, { variantId: 'v4', serial: 'sn-1', warrantyMonths: 6 }, ctx()).changes)
    const id = serialId('v4', 'SN-1')
    s = applyChanges(s, setSerialStatus(s, id, 'sold', 'INV-1', ctx()).changes)
    expect(() => setSerialStatus(s, id, 'sold', 'x', ctx())).toThrow('already')
    s = applyChanges(s, setSerialStatus(s, id, 'in_stock', 'return', ctx()).changes)
    expect(s.serials[id].history.map((h) => h.status)).toEqual(['in_stock', 'sold', 'in_stock'])
    expect(s.serials[id].billNo).toBeUndefined()
    expect(() => registerSerial(s, { variantId: 'v4', serial: 'ab', }, ctx())).toThrow('serial number')
  })
})

describe('bundles', () => {
  test('a kit is a no-stock item priced by you; its components are checked', () => {
    let s = warehouseState()
    expect(() => createBundle(s, { name: '', categoryId: 'cat_mshirt', components: [{ variantId: 'v1', qty: 1 }], price: 10 }, ctx())).toThrow('name')
    expect(() => createBundle(s, { name: 'K', categoryId: 'cat_mshirt', components: [], price: 10 }, ctx())).toThrow('at least one')
    expect(() => createBundle(s, { name: 'K', categoryId: 'cat_mshirt', components: [{ variantId: 'v1', qty: 1 }], price: 0 }, ctx())).toThrow('price')
    expect(() => createBundle(s, { name: 'K', categoryId: 'cat_mshirt', components: [{ variantId: 'zz', qty: 1 }], price: 5 }, ctx())).toThrow('no longer exists')
    const r = createBundle(s, { name: 'Pair', categoryId: 'cat_mshirt', components: [{ variantId: 'v1', qty: 2 }, { variantId: 'v1', qty: 1 }, { variantId: 'v2', qty: 1 }], price: 2000 }, ctx())
    s = applyChanges(s, r.changes)
    expect(r.bundle.components).toEqual([{ variantId: 'v1', qty: 3 }, { variantId: 'v2', qty: 1 }])
    expect(s.products[s.variants[r.bundle.variantId].productId].trackStock).toBe(false)
    expect(r.changes.outbox).toBeUndefined()
    const up = updateBundle(s, r.bundle.id, { price: 1800, active: false }, ctx())
    s = applyChanges(s, up.changes)
    expect(s.variants[r.bundle.variantId].price).toBe(1800)
    expect(s.bundles[r.bundle.id].active).toBe(false)
    expect(s.products[s.variants[r.bundle.variantId].productId].active).toBe(false)
    expect(updateBundle(s, r.bundle.id, { name: 'Pair+' }, ctx()).bundle.name).toBe('Pair+')
  })
})
