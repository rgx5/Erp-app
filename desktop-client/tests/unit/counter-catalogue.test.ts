import { describe, expect, it } from 'vitest'
import { buildIndex, searchItems, type LocalItem } from '../../src/features/pos/catalogueSearch'
import { localTotal, type CartLine } from '../../src/features/pos/totals'
import { eligibleOf, grossOf, withWalletDiscount } from '../../src/features/pos/wallet'
import { worthKeeping } from '../../src/offline/queryPersist'

const item = (code: string, name: string, o: Partial<LocalItem> = {}): LocalItem => ({ id: code, code, name, taxCodeId: null, tracking: 'none', mrp: null, noDiscount: false, barcodes: [], active: true, ...o })
const ix = buildIndex([
  item('STL-WIDGET', 'Steel widget', { barcodes: ['8901234567890'] }), item('WID-2', 'Wide brush'), item('TEA-1KG', 'Tea 1 kg'), item('SUG-5KG', 'Sugar 5 kg'),
  item('OLD-1', 'Withdrawn item', { active: false }), item('BRS-FIT', 'Brass fitting 1/2"', { barcodes: ['8909999999999', 'FIT-ALT'] }),
])

describe('finding items on the counter, without the server', () => {
  it('takes an exact barcode or code at once', () => {
    expect(searchItems(ix, '8901234567890').exact?.code).toBe('STL-WIDGET')
    expect(searchItems(ix, 'tea-1kg').exact?.code).toBe('TEA-1KG')
    expect(searchItems(ix, 'fit-alt').exact?.code).toBe('BRS-FIT') // a second barcode on the same item
  })
  it('offers the best matches first: code starts, then words that start, then anywhere', () => {
    expect(searchItems(ix, 'wid').matches.map((m) => m.code)).toEqual(['WID-2', 'STL-WIDGET']) // WID-2's code starts with it; the widget has a word that does
    expect(searchItems(ix, 'steel wid').matches.map((m) => m.code)).toEqual(['STL-WIDGET']) // every typed word must start a word of the name
    expect(searchItems(ix, 'kg').matches.map((m) => m.code).sort()).toEqual(['SUG-5KG', 'TEA-1KG'])
    expect(searchItems(ix, 'idget').matches.map((m) => m.code)).toEqual(['STL-WIDGET']) // inside a word
  })
  it('never offers withdrawn items, and has nothing for empty text or no match', () => {
    expect(searchItems(ix, 'withdrawn').matches).toEqual([]); expect(searchItems(ix, 'old-1').exact).toBeNull()
    expect(searchItems(ix, '   ')).toEqual({ exact: null, matches: [] }); expect(searchItems(ix, 'zzzz').matches).toEqual([])
  })
  it('stays instant on a big catalogue', () => {
    const big = buildIndex(Array.from({ length: 50_000 }, (_, i) => item(`ITM-${String(i).padStart(5, '0')}`, `Product number ${i} blue`, { barcodes: [`89${String(i).padStart(11, '0')}`] })))
    const t0 = performance.now(); const r = searchItems(big, 'product 4999'); const dt = performance.now() - t0
    expect(r.matches.length).toBeGreaterThan(0); expect(dt).toBeLessThan(250)
    expect(searchItems(big, '8900000049999').exact?.code).toBe('ITM-49999')
  })
})

const line = (o: Partial<CartLine> = {}): CartLine => ({ key: 'l1', itemId: 'a', code: 'A', name: 'A', quantity: '2', unitPrice: '100', discountPercent: '0', taxInclusive: true, taxCodeId: null, tracking: 'none', batchId: '', serials: '', ...o } as CartLine)

describe('a half-typed field never crashes the counter', () => {
  it('treats letters, symbols and a half-typed number like an empty one (the screen once crashed on "abc")', () => {
    for (const bad of ['abc', '.', '-', '1e5', ' ']) { const l = line({ discountPercent: bad, quantity: bad === '.' ? '.' : '2' }); expect(() => localTotal([l]), bad).not.toThrow(); expect(() => grossOf([l]), bad).not.toThrow(); expect(() => eligibleOf([l]), bad).not.toThrow(); expect(() => withWalletDiscount([l], 100_000n), bad).not.toThrow() }
  })
  it('treats an empty discount as none instead of throwing "Not a valid amount"', () => {
    expect(() => localTotal([line({ discountPercent: '' })])).not.toThrow()
    expect(localTotal([line({ discountPercent: '' })]).grandTotal).toBe('200.0000')
    expect(() => grossOf([line({ discountPercent: '' })])).not.toThrow()
    expect(eligibleOf([line({ discountPercent: '' })])).toBe(2_000_000n)
    expect(() => withWalletDiscount([line({ discountPercent: '' })], 100_000n)).not.toThrow()
  })
})

describe('what the counter keeps on disk', () => {
  it('is only what it needs to open offline', () => {
    for (const k of [['companies'], ['gst-registrations', 'c'], ['business-locations', 'c'], ['warehouses', 'c', []], ['price-lists'], ['prices', 'p'], ['pos', 'terminals', 'c'], ['pos', 'shifts', 'c', 'open'], ['pos', 'settings', 'c']]) expect(worthKeeping(k), JSON.stringify(k)).toBe(true)
    for (const k of [['parties-by-id', 'x'], ['invoice', '1'], ['dashboard', 'c'], ['pos', 'sales', 'c'], ['pos', 'approvers'], ['items-by-id', 'x'], ['users'], ['audit']]) expect(worthKeeping(k), JSON.stringify(k)).toBe(false)
  })
})
