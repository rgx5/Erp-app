import { filterCatalog, rollUp, rulesFromConfig } from '../catalog'
import { barcodeSvg, labelsHtml } from '../labels'
import { loadVariantViews } from '../views'
import type { Product, Variant } from '../types'

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', styleCode: 'MS-101', name: 'Oxford Shirt', categoryId: 'c1', brand: 'Acme', fabric: '', season: '', hsn: '6205', active: true, createdAt: 0, ...over,
})
const variant = (over: Partial<Variant> = {}): Variant => ({
  id: 'v1', productId: 'p1', sku: 'MS-101-M', barcode: '2100000000015', size: 'M', color: '', cost: 400, mrp: 1299, price: 999, stock: 10, reorderLevel: 3, ...over,
})

describe('rollUp', () => {
  test('totals stock, counts low / out / unpriced variants and spans the price range', () => {
    const products = [product()]
    const variants = [
      variant({ id: 'a', stock: 10, price: 900 }),
      variant({ id: 'b', stock: 2, price: 1100 }), // low (<= reorder level 3)
      variant({ id: 'c', stock: 0, price: 1000 }), // out
      variant({ id: 'd', stock: 5, price: 0 }), // needs a price
    ]
    const [row] = rollUp(products, loadVariantViews(products, variants))
    expect(row.stock).toBe(17)
    expect(row.low).toBe(1)
    expect(row.out).toBe(1)
    expect(row.unpriced).toBe(1)
    expect(row.minPrice).toBe(900)
    expect(row.maxPrice).toBe(1100)
    // value at cost: (10 + 2 + 0 + 5) × 400
    expect(row.value).toBe(6800)
  })

  test('services hold no stock and are never "out"', () => {
    const products = [product({ trackStock: false })]
    const [row] = rollUp(products, loadVariantViews(products, [variant({ stock: 0 })]))
    expect(row.stock).toBe(0)
    expect(row.out).toBe(0)
    expect(row.low).toBe(0)
  })

  test('a product without variants still gets a row', () => {
    const [row] = rollUp([product()], [])
    expect(row.variants).toHaveLength(0)
    expect(row.minPrice).toBe(0)
  })
})

describe('filterCatalog', () => {
  const products = [
    product({ id: 'p1', name: 'Oxford Shirt', styleCode: 'MS-101', categoryId: 'c1' }),
    product({ id: 'p2', name: 'Denim Jeans', styleCode: 'MJ-201', categoryId: 'c2', brand: 'Levante' }),
    product({ id: 'p3', name: 'Old Stock Tee', styleCode: 'MT-301', categoryId: 'c1', active: false }),
  ]
  const variants = [
    variant({ id: 'a', productId: 'p1', sku: 'MS-101-M', barcode: '2100000000015', stock: 0 }),
    variant({ id: 'b', productId: 'p2', sku: 'MJ-201-32', barcode: '2100000000022', stock: 2, price: 0 }),
    variant({ id: 'c', productId: 'p3', sku: 'MT-301-L', barcode: '2100000000039' }),
  ]
  const rows = rollUp(products, loadVariantViews(products, variants))
  const names = (r: typeof rows) => r.map((x) => x.product.name)

  test('hides archived items by default and shows only them under "archived"', () => {
    expect(names(filterCatalog(rows, '', '', ''))).toEqual(['Denim Jeans', 'Oxford Shirt'])
    expect(names(filterCatalog(rows, '', 'archived', ''))).toEqual(['Old Stock Tee'])
  })

  test('searches name, code, brand, SKU and barcode', () => {
    expect(names(filterCatalog(rows, 'oxford', '', ''))).toEqual(['Oxford Shirt'])
    expect(names(filterCatalog(rows, 'mj-201', '', ''))).toEqual(['Denim Jeans'])
    expect(names(filterCatalog(rows, 'levante', '', ''))).toEqual(['Denim Jeans'])
    expect(names(filterCatalog(rows, 'ms-101-m', '', ''))).toEqual(['Oxford Shirt'])
    expect(names(filterCatalog(rows, '2100000000022', '', ''))).toEqual(['Denim Jeans'])
    expect(names(filterCatalog(rows, 'zzz', '', ''))).toEqual([])
  })

  test('stock and pricing filters', () => {
    expect(names(filterCatalog(rows, '', 'out', ''))).toEqual(['Oxford Shirt'])
    expect(names(filterCatalog(rows, '', 'low', ''))).toEqual(['Denim Jeans'])
    expect(names(filterCatalog(rows, '', 'pricing', ''))).toEqual(['Denim Jeans'])
  })

  test('category filter', () => {
    expect(names(filterCatalog(rows, '', '', 'c2'))).toEqual(['Denim Jeans'])
  })
})

describe('rulesFromConfig', () => {
  test('falls back to the defaults when a category has no rules', () => {
    expect(rulesFromConfig(undefined, { hsn: '6205', reorder: 4 })).toEqual({
      hsn: '6205', unit: 'pc', fractional: undefined, step: undefined, minQty: undefined, trackStock: true, noDiscount: false, gstRate: undefined, reorderLevel: 4,
    })
  })

  test('a category decides how its items are sold', () => {
    const r = rulesFromConfig({ unit: 'kg', fractional: true, step: 0.25, minQty: 0.25, hsn: '1101', gstRate: 5, trackStock: false, noDiscount: true, reorderLevel: 9 }, { hsn: '0', reorder: 1 })
    expect(r).toMatchObject({ unit: 'kg', fractional: true, step: 0.25, minQty: 0.25, hsn: '1101', gstRate: 5, trackStock: false, noDiscount: true, reorderLevel: 9 })
  })
})

describe('labels', () => {
  test('a barcode becomes bars with a quiet zone, no library needed', () => {
    const svg = barcodeSvg('2100000000015', 50, 12)
    expect(svg).toContain('<svg')
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(20)
  })

  test('one label per copy, and anything typed by the owner is escaped', () => {
    const html = labelsHtml([{ name: '<Shirt> & Co', variant: 'M / Navy', sku: 'S-1', barcode: '2100000000015', price: 999, mrp: 1299, copies: 3 }], {
      store: 'A&B', widthMm: 62, heightMm: 36, perRow: 3, showMrp: true, showStore: true,
    })
    expect((html.match(/class="l"/g) ?? []).length).toBe(3)
    expect(html).toContain('&lt;Shirt&gt; &amp; Co')
    expect(html).not.toContain('<Shirt>')
    expect(html).toContain('MRP')
  })

  test('MRP is left off when it is not above the price', () => {
    const html = labelsHtml([{ name: 'Tee', variant: '', sku: 'T', barcode: '2100000000015', price: 500, mrp: 500, copies: 1 }])
    expect(html).not.toContain('MRP')
  })
})
