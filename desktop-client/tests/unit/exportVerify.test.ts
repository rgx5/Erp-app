import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyBackupFile } from '@/features/data/exportVerify'

const make = (mut?: (d: Record<string, unknown>) => void): string => {
  const tables = { items: [{ id: 'a' }, { id: 'b' }], sales_invoices: [{ id: 'x', grand_total: '100.0000' }], tenant_directory: [{ slug: 'acme' }] }
  const d: Record<string, unknown> = { format: 'onesync-export-v1', exportedAt: '2026-11-24T00:00:00Z', tenantId: 't1', counts: { items: 2, sales_invoices: 1, tenant_directory: 1 }, checksum: createHash('sha256').update(JSON.stringify(tables)).digest('hex'), tables }
  mut?.(d)
  return JSON.stringify(d)
}

describe('backup file check', () => {
  it('accepts a whole file and says which business it is from', async () => {
    const r = await verifyBackupFile(make(), 'acme')
    expect(r).toMatchObject({ ok: true, tables: 3, records: 4, business: 'this' })
    expect(r.top).toEqual([{ name: 'Items', count: 2 }, { name: 'Sales invoices', count: 1 }])
    expect((await verifyBackupFile(make(), 'someone-else')).business).toBe('other')
  })
  it('refuses a changed, cut-down, checksum-less or foreign file', async () => {
    expect((await verifyBackupFile(make((d) => { (d['tables'] as { sales_invoices: { grand_total: string }[] }).sales_invoices[0]!.grand_total = '1.0000' }))).message).toMatch(/changed or damaged/)
    expect((await verifyBackupFile(make((d) => { d['counts'] = { items: 3 } }))).message).toMatch(/incomplete: items should have 3/)
    expect((await verifyBackupFile(make((d) => { delete d['checksum'] }))).message).toMatch(/no checksum/)
    expect((await verifyBackupFile('{"format":"other"}')).message).toMatch(/not a OneSyncERP/)
    expect((await verifyBackupFile('nonsense')).message).toMatch(/could not be read/)
  })
})
