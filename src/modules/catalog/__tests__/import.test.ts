import { applyChanges, listOf } from '@/data/state'
import { toCsv } from '@/domain/csv'
import { importItems, postOpeningStock, saveCustomField } from '../ops'
import { exportRows, mapColumns, previewImport, templateRows } from '../import'
import { parseCsv, readTable, toXlsx } from '../sheet'
import { baseState, ctx } from './helpers'

const HEAD = 'Item code,Name,Category,Brand,HSN,Unit,GST %,Option 1,Option 2,SKU,Barcode,Cost,MRP,Price,Stock,Reorder level'

describe('reading files', () => {
  test('CSV: quotes, doubled quotes, line breaks, semicolons and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', 'z']])
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })
  test('Excel round trip', () => {
    const bytes = toXlsx([['Name', 'Price'], ['Tee', 299], ['Cap', 150.5]])
    expect(readTable(bytes, 'xlsx')).toEqual([['Name', 'Price'], ['Tee', '299'], ['Cap', '150.5']])
  })
  test('headings are matched by their usual names', () => {
    const m = mapColumns(['Product Name', 'Selling Price', 'Qty', 'Colour', 'Mystery'], [])
    expect(m.cols).toMatchObject({ name: 0, price: 1, stock: 2, color: 3 })
    expect(m.ignored).toEqual(['Mystery'])
  })
})

describe('preview', () => {
  test('a file with no recognisable heading cannot be imported', () => {
    expect(previewImport([['foo', 'bar'], ['1', '2']], baseState()).fatal).toMatch(/Name, Item code/)
    expect(previewImport([['Name']], baseState()).fatal).toMatch(/no rows/)
  })

  test('new items, updates, unchanged rows and refused rows are told apart', () => {
    const table = parseCsv([
      HEAD,
      'KU-1,Kurta,Kurtas,Fab,6104,pc,5,M,Blue,,,450,999,799,10,3',
      'KU-1,Kurta,Kurtas,Fab,6104,pc,5,L,Blue,,,450,999,799,6,3',
      ',Mug,,,,,,,,,,50,,0,5,',
      ',Cap,,,,,,,,,,abc,,-5,5,',
      ',,,,,,,,,MS-101-NAV-M,,,,1099,,',
      ',,,,,,,,,MS-101-NAV-L,,,,999,,',
    ].join('\n'))
    const p = previewImport(table, baseState())
    expect(p.rows.map((r) => r.action)).toEqual(['create', 'create', 'create', 'error', 'update', 'same'])
    expect(p.rows[3].errors.join()).toMatch(/Cost “abc”.*Price cannot be negative/)
    expect(p.rows[2].warnings.join()).toMatch(/No selling price/)
    expect(p.rows[4].changes).toEqual(['Price ₹999.00 → ₹1,099.00'])
    expect(p.newCategories).toEqual(['Kurtas'])
    expect(p.counts).toMatchObject({ create: 3, update: 1, same: 1, error: 1, items: 2 })
  })

  test('duplicates inside the file and clashes with what exists are refused', () => {
    const p = previewImport(parseCsv([
      HEAD,
      'AA-1,Tee,Tops,,,,,M,Red,,,,,100,,',
      'AA-1,Tee,Tops,,,,,M,Red,,,,,100,,',
      'AA-2,Hat,Tops,,,,,,,,2100000000015,,,100,,',
      'AA-3,Hat,Tops,,,,,,,,,,,100,,',
      'AA-4,Hat,Tops,,,,,,,SKU-9,,,,100,,',
      'AA-5,Hat,Tops,,,,,,,SKU-9,,,,100,,',
    ].join('\n')), baseState())
    expect(p.rows.map((r) => r.action)).toEqual(['create', 'error', 'update', 'create', 'create', 'error'])
    expect(p.rows[1].errors.join()).toMatch(/same item and options/)
    expect(p.rows[5].errors.join()).toMatch(/SKU-9 appears twice/)
  })

  test('an existing item gets a new size without repeating its SKU', () => {
    const p = previewImport(parseCsv([HEAD, 'MS-101,Oxford Shirt,Shirts,,,,,XL,Navy,,,400,1299,999,2,'].join('\n')), baseState())
    expect(p.rows[0]).toMatchObject({ action: 'create', productId: 'p1' })
  })
})

describe('applying an import', () => {
  test('writes items, variants with barcodes, opening stock, categories; edits prices and stock; audits once', () => {
    const s = baseState()
    const table = parseCsv([
      HEAD,
      'KU-1,Kurta,Kurtas,Fab,6104,pc,5,M,Blue,,,450,999,799,10,3',
      'KU-1,Kurta,Kurtas,Fab,6104,pc,5,L,Blue,,,450,999,799,6,3',
      ',Cloth,Fabric,,,m,,,,,,60,,120,25,',
      ',,,,,,,,,MS-101-NAV-M,,,,1099,12,',
    ].join('\n'))
    const r = importItems(s, table, ctx(), { fileName: 'items.csv' })
    expect(r).toMatchObject({ items: 2, created: 3, updated: 1, skipped: 0 })
    expect(r.openings).toHaveLength(3)
    expect(listOf(applyChanges(s, r.changes).variants).every((v) => v.productId === 'p1' || v.stock === 0)).toBe(true) // written with 0; stock comes from the ledger
    const mid = applyChanges(s, r.changes)
    const after = applyChanges(mid, postOpeningStock(mid, r.openings, ctx()).changes)
    const kurta = listOf(after.products).find((p) => p.styleCode === 'KU-1')!
    expect(kurta).toMatchObject({ name: 'Kurta', gstRate: 5, unit: 'pc' })
    const kv = listOf(after.variants).filter((v) => v.productId === kurta.id)
    expect(kv.map((v) => [v.sku, v.stock]).sort()).toEqual([['KU-1-BLU-L', 6], ['KU-1-BLU-M', 10]])
    expect(new Set(listOf(after.variants).map((v) => v.barcode)).size).toBe(listOf(after.variants).length)
    const cloth = listOf(after.products).find((p) => p.name === 'Cloth')!
    expect(cloth).toMatchObject({ unit: 'm', fractional: true })
    expect(cloth.styleCode).toMatch(/^[A-Z]{2}-101$/)
    expect(listOf(after.categories).map((c) => c.name).sort()).toEqual(['Fabric', 'Kurtas', 'Shirts'])
    expect(after.variants.v1).toMatchObject({ price: 1099, stock: 12 })
    expect(postOpeningStock(mid, [], ctx()).changes).toEqual({})
    expect(listOf(after.moves).map((m) => [m.type, m.qty]).sort()).toEqual([['adjust', 2], ['opening', 10], ['opening', 25], ['opening', 6]].sort())
    expect(r.changes.put!.audit).toHaveLength(1)
  })

  test('refuses an empty or all-bad file', () => {
    expect(() => importItems(baseState(), parseCsv(`${HEAD}\n,,,,,,,,,,,abc,,,,`), ctx())).toThrow(/No row can be imported/)
    expect(() => importItems(baseState(), parseCsv(`${HEAD}\n,,,,,,,,,MS-101-NAV-M,,,,999,,`), ctx())).toThrow(/Nothing to change/)
  })

  test('a large file keeps every id and barcode distinct', () => {
    const rows = [HEAD]
    for (let i = 0; i < 400; i++) rows.push(`,Item ${i},Bulk,,,,,,,,,10,20,15,1,`)
    const r = importItems(baseState(), parseCsv(rows.join('\n')), ctx())
    const after = applyChanges(baseState(), r.changes)
    expect(listOf(after.products)).toHaveLength(401)
    expect(new Set(listOf(after.variants).map((v) => v.id)).size).toBe(402)
    expect(new Set(listOf(after.variants).map((v) => v.barcode)).size).toBe(402)
    expect(new Set(listOf(after.products).map((p) => p.styleCode)).size).toBe(401)
  })
})

describe('export', () => {
  test('exports every column and importing it back changes nothing', () => {
    const s = baseState()
    const rows = exportRows(s)
    expect(rows[0]).toContain('Barcode')
    expect(rows).toHaveLength(3)
    const csv = toCsv(rows)
    const p = previewImport(parseCsv(csv), s)
    expect(p.counts).toMatchObject({ same: 2, error: 0, create: 0, update: 0 })
    expect(templateRows()).toHaveLength(3)
  })

  test('custom fields travel in the file and are validated', () => {
    let s = baseState()
    const f = saveCustomField(s, { label: 'Warranty months', type: 'number', options: [], required: false, active: true }, undefined, ctx())
    s = applyChanges(s, f.changes)
    const defs = listOf(s.customFields)
    const p = previewImport(parseCsv(`${HEAD},Warranty months\n,Fan,,,,,,,,,,,,900,,,24\n,Heater,,,,,,,,,,,,900,,,x`), s, defs)
    expect(p.rows[0].data.custom[f.field.id]).toBe(24)
    expect(p.rows[1].errors.join()).toMatch(/must be a number/)
    const r = importItems(s, parseCsv(`${HEAD},Warranty months\n,Fan,,,,,,,,,,,,900,,,24`), ctx())
    const after = applyChanges(s, r.changes)
    expect(listOf(after.customFieldValues)[0].values[f.field.id]).toBe(24)
    expect(exportRows(after, listOf(after.customFields))[0].slice(-1)).toEqual(['Warranty months'])
  })
})
