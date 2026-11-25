import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readImportFile } from '@/features/import/readers'
import { migrateVyapar, rateOfTax, type Server } from '@/features/migrate/engine'
import { isVyapar, parseVyapar } from '@/features/migrate/vyapar'

const load = async () => parseVyapar(await readImportFile('sample.vyp', new Uint8Array(readFileSync('tests/fixtures/import/vyapar-sample.vyp'))))

describe('reading a Vyapar backup', () => {
  it('recognises the file and brings out the business, parties, items and documents', async () => {
    const src = await readImportFile('sample.vyp', new Uint8Array(readFileSync('tests/fixtures/import/vyapar-sample.vyp')))
    expect(isVyapar(src)).toBe(true)
    expect(isVyapar({ format: 'x', tables: [{ name: 'orders', columns: ['a'], rows: [['1']] }] })).toBe(false)
    const d = await load()
    expect(d.firm?.name).toBe('Sunrise Tech Solutions')
    expect(d.parties.length).toBeGreaterThan(20)
    expect(d.expenseCategories.length).toBe(5) // type 2 "names" are expense heads, not people
    expect(d.parties.every((p) => p.isCustomer || p.isSupplier)).toBe(true)
    expect(new Set(d.parties.map((p) => p.code)).size).toBe(d.parties.length) // codes are unique
    expect(d.items.some((i) => i.stock > 0 && i.stockValue > 0)).toBe(true)
    expect(d.documents.map((x) => x.kind)).toEqual(expect.arrayContaining(['Sale invoices', 'Purchase bills', 'Estimates and quotations']))
    expect(d.firstDate && d.lastDate && d.firstDate <= d.lastDate).toBe(true)
  })
  it('calls a supplier someone only bought from, and works out the GST rate of a tax entry', async () => {
    const d = await load()
    expect(d.parties.some((p) => p.isSupplier && !p.isCustomer)).toBe(true)
    expect(rateOfTax('GST@18%', 18)).toBe(18); expect(rateOfTax('SGST@9%', 9)).toBe(18); expect(rateOfTax('Exempted', 0)).toBe(0)
  })
})

/** A small stand-in for the server: remembers what is created, refuses duplicate codes the way the real one does. */
function fakeServer() {
  const made: Record<string, Record<string, unknown>[]> = {}
  let n = 0
  const seeded: Record<string, unknown[]> = { '/v1/units': [{ id: 'u-nos', code: 'NOS', name: 'Numbers' }, { id: 'u-pcs', code: 'PCS', name: 'Pieces' }, { id: 'u-kgs', code: 'KGS', name: 'Kilograms' }], '/v1/tax-codes': [{ id: 't18', code: 'GST18', name: 'GST 18%' }, { id: 't5', code: 'GST5', name: 'GST 5%' }] }
  const server: Server = {
    async get(path) {
      if (path === '/v1/companies') return { items: made['/v1/companies'] ?? [] }
      if (path.endsWith('/gst-registrations')) return { items: made['reg'] ?? [] }
      if (path === '/v1/business-locations') return { items: made['/v1/business-locations'] ?? [] }
      if (path === '/v1/warehouses') return { items: made['/v1/warehouses'] ?? [] }
      if (path === '/v1/fiscal-years') return { items: made['/v1/fiscal-years'] ?? [] }
      return { items: [...(seeded[path] ?? []), ...(made[path] ?? [])], nextCursor: null }
    },
    async post(path, body) {
      const b = body as Record<string, unknown>
      const bucket = /gst-registrations/.test(path) ? 'reg' : path
      const list = (made[bucket] ??= [])
      if (b['code'] && list.some((x) => x['code'] === b['code'])) { const { ApiError } = await import('@/api/errors'); throw new ApiError(409, 'conflict', 'That code is already used') }
      const row = { id: `${bucket}-${++n}`, ...b }; list.push(row); return row
    },
  }
  return { server, made }
}
const choices = { business: true, catalogue: true, parties: true, banks: true, stock: true, assumeBusinessState: true }

describe('migrating from Vyapar', () => {
  it('creates the business, catalogue, parties and stock, and a second run only skips', async () => {
    const d = await load(); const { server, made } = fakeServer()
    const r1 = await migrateVyapar(server, d, choices, 'b1', () => undefined)
    expect(made['/v1/companies']?.length).toBe(1)
    expect(made['/v1/items']?.length).toBe(d.items.length)
    expect(made['/v1/parties']?.length).toBe(d.parties.length)
    const stock = made['/v1/stock/movements']?.flatMap((m) => m['lines'] as unknown[]) ?? []
    expect(stock.length).toBe(d.items.filter((i) => !i.service && i.stock > 0).length)
    expect(r1.phases.find((p) => p.phase === 'Items')?.failed).toBe(0)
    expect(r1.phases.find((p) => p.phase === 'Opening stock')?.notes.join(' ')).toMatch(/negative stock/)
    expect(r1.problems.filter((p) => p.phase === 'Items')).toEqual([])
    // run again with a fresh fake that already holds the first run's records: nothing is duplicated
    const before = made['/v1/items']?.length
    const r2 = await migrateVyapar(server, d, { ...choices, business: false }, 'b2', () => undefined)
    expect(made['/v1/items']?.length).toBe(before)
    expect(r2.phases.find((p) => p.phase === 'Items')?.skipped).toBe(d.items.length)
  })
  it('brings in only what was chosen', async () => {
    const d = await load(); const { server, made } = fakeServer()
    await migrateVyapar(server, d, { business: false, catalogue: false, parties: true, banks: false, stock: false }, 'b3', () => undefined)
    expect(made['/v1/parties']?.length).toBe(d.parties.length)
    expect(made['/v1/items']).toBeUndefined()
  })
})
