export interface BackupCheck { ok: boolean; message: string; exportedAt?: string; tables?: number; records?: number; business?: 'this' | 'other'; top?: { name: string; count: number }[] }

const sha256Hex = async (text: string): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const LABELS: Record<string, string> = { items: 'Items', parties: 'Customers and suppliers', sales_invoices: 'Sales invoices', supplier_bills: 'Supplier bills', journal_entries: 'Journal entries', stock_ledger: 'Stock movements', customer_receipts: 'Receipts', employees: 'Employees' }

/** Checks a downloaded data file is whole and unchanged: its format, its checksum (over the records) and its counts. */
export async function verifyBackupFile(text: string, thisBusinessCode?: string): Promise<BackupCheck> {
  let data: { format?: string; exportedAt?: string; tenantId?: string; counts?: Record<string, number>; checksum?: string; tables?: Record<string, unknown[]> }
  try { data = JSON.parse(text) as typeof data } catch { return { ok: false, message: 'This is not a data file: it could not be read.' } }
  if (data.format !== 'onesync-export-v1' || !data.tables || typeof data.tables !== 'object') return { ok: false, message: 'This is not a OneSyncERP data file.' }
  if (!data.checksum) return { ok: false, message: 'This file has no checksum, so it cannot be checked. Download a new copy.' }
  if ((await sha256Hex(JSON.stringify(data.tables))) !== data.checksum) return { ok: false, message: 'The file has been changed or damaged: its checksum does not match its records.' }
  for (const [t, n] of Object.entries(data.counts ?? {})) if ((data.tables[t]?.length ?? 0) !== n) return { ok: false, message: `The file is incomplete: ${t} should have ${n} records.` }
  const first = (data.tables['tenant_directory'] ?? [])[0] as { slug?: unknown } | undefined
  const code = typeof first?.slug === 'string' ? first.slug : undefined
  const counts = Object.entries(data.tables).map(([name, rows]) => ({ name, count: rows.length }))
  return {
    ok: true, message: 'The file is whole and unchanged.', ...(data.exportedAt ? { exportedAt: data.exportedAt } : {}), tables: counts.length, records: counts.reduce((s, c) => s + c.count, 0),
    ...(thisBusinessCode && code ? { business: code === thisBusinessCode ? ('this' as const) : ('other' as const) } : {}),
    top: counts.filter((c) => LABELS[c.name]).map((c) => ({ name: LABELS[c.name] as string, count: c.count })),
  }
}
