import { query } from '@/api/client'
import { item as itemSchema, page, party as partySchema, type Item, type Party } from '@/api/schemas'
import { currentApi } from '@/auth/session'
import { download, toCsv } from '@/features/masterdata/csv'
import { roleLabel } from '@/features/masterdata/PartyForm'

/** Every page of a list, 200 at a time. */
async function everything<T>(path: '/v1/items' | '/v1/parties', schema: Parameters<typeof page>[0], filter: Record<string, unknown>): Promise<T[]> {
  const all: T[] = []
  let cursor: string | undefined
  const api = currentApi()
  do {
    const p = await api.call(api.raw.GET(path, { params: { query: query({ limit: 200, cursor, ...filter }) } } as never), page(schema)) as { items: T[]; nextCursor?: string | null }
    all.push(...p.items); cursor = p.nextCursor ?? undefined
  } while (cursor)
  return all
}

export interface Lookups { unitCode: Map<string, string>; taxCode: Map<string, string>; catCode: Map<string, string> }

/** All items (active and inactive) as a CSV that the importer can read back. */
export async function exportItemsCsv(l: Lookups): Promise<number> {
  const all = await everything<Item>('/v1/items', itemSchema, {})
  download('items.csv', toCsv(['Code', 'Name', 'Type', 'Unit', 'HSN/SAC', 'GST code', 'Sellable', 'Purchasable', 'Status', 'Category code', 'Brand', 'MRP'], all.map((i) => [i.code, i.name, i.itemType, l.unitCode.get(i.baseUomId) ?? '', i.hsnSacCode ?? '', i.taxCodeId ? l.taxCode.get(i.taxCodeId) ?? '' : '', i.isSellable ? 'yes' : 'no', i.isPurchasable ? 'yes' : 'no', i.status, i.categoryId ? l.catCode.get(i.categoryId) ?? '' : '', i.brand ?? '', i.mrp ?? ''])))
  return all.length
}

/** All customers or all suppliers (every status) as a CSV. */
export async function exportPartiesCsv(role: 'customer' | 'supplier'): Promise<number> {
  const all = await everything<Party>('/v1/parties', partySchema, { role })
  download(`${role === 'customer' ? 'customers' : 'suppliers'}.csv`, toCsv(['Code', 'Legal name', 'Trade name', 'Role', 'GST treatment', 'GSTIN', 'PAN', 'Status'], all.map((p) => [p.code, p.legalName, p.tradeName ?? '', roleLabel(p), p.gstTreatment, p.gstin ?? '', p.pan ?? '', p.status])))
  return all.length
}
