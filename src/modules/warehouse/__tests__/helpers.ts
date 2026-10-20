import { baseState, ctx, NOW, product, variant } from '@/data/__tests__/helpers'
import type { DataState } from '@/data/state'
import { registerBillHook, registerCartAdjuster, registerReceiptHook, registerReturnHook } from '@/modules/registry'
import { billHook, packAdjuster, receiptHook, returnHook } from '../hooks'
import '../replication'

export { baseState, ctx, NOW }
export const DAY = 86_400_000

/** The module's hooks, registered the way the app does it (index.tsx). Call once per test file. */
export function registerWarehouseHooks() {
  registerBillHook(billHook)
  registerReceiptHook(receiptHook)
  registerReturnHook(returnHook)
  registerCartAdjuster(packAdjuster)
}

/**
 * The base business plus: a medicine tracked by batch (v3), a phone tracked by serial number with a 12-month warranty (v4),
 * a box-of-12 conversion on the shirt, and two locations.
 */
export function warehouseState(): DataState {
  const s = baseState()
  s.products = {
    ...s.products,
    p2: product({ id: 'p2', styleCode: 'MED-1', name: 'Paracetamol 500', unit: 'pc' }),
    p3: product({ id: 'p3', styleCode: 'PH-1', name: 'Nova Phone', unit: 'pc' }),
  }
  s.variants = {
    ...s.variants,
    v3: variant({ id: 'v3', productId: 'p2', sku: 'MED-1', barcode: '2100000000039', size: '', color: '', cost: 2, avgCost: 2, mrp: 5, price: 4, stock: 0 }),
    v4: variant({ id: 'v4', productId: 'p3', sku: 'PH-1', barcode: '2100000000046', size: '', color: '', cost: 8000, avgCost: 8000, mrp: 12000, price: 10000, stock: 0 }),
  }
  s.itemRules = { p2: { id: 'p2', trackBatch: true }, p3: { id: 'p3', trackSerial: true, warrantyMonths: 12 } }
  s.unitConversions = { uc1: { id: 'uc1', productId: 'p1', unit: 'box', factor: 12, price: 10_000 } }
  s.locations = {
    locA: { id: 'locA', name: 'Godown', type: 'warehouse', active: true, createdAt: NOW },
    locB: { id: 'locB', name: 'Shelf A1', type: 'shelf', parentId: 'locA', active: true, createdAt: NOW },
  }
  return s
}
