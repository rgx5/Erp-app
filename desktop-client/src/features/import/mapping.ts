import type { SourceTable } from './readers'

/** A field the import can fill, with the other names programs give it. */
export interface TargetField { key: string; label: string; required: boolean; /** Names it goes by in other software and exports. */ synonyms?: string[] }

export const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Names seen in exports from Vyapar, Tally, Busy, Marg, Zoho Books, QuickBooks and plain spreadsheets, by the field they fill. */
export const SYNONYMS: Record<string, string[]> = {
  code: ['code', 'itemcode', 'productcode', 'sku', 'partycode', 'customercode', 'suppliercode', 'vendorcode', 'ledgercode', 'accountcode', 'itemno', 'partyno', 'barcode'],
  name: ['name', 'itemname', 'productname', 'stockitem', 'stockitemname', 'particulars', 'item', 'product', 'title', 'itemdescription', 'productdescription', 'description'],
  legalname: ['legalname', 'name', 'partyname', 'fullname', 'customername', 'suppliername', 'vendorname', 'ledgername', 'ledger', 'party', 'companyname', 'company', 'accountname', 'displayname', 'businessname', 'contactname', 'billingname', 'namefullname'],
  tradename: ['tradename', 'shopname', 'aliasname', 'alias', 'tradingname', 'dba'],
  role: ['role', 'partytype', 'nametype', 'type', 'contacttype', 'ledgergroup', 'parent', 'group'],
  gsttreatment: ['gsttreatment', 'gsttype', 'registrationtype', 'gstregistrationtype', 'taxtreatment', 'gstregtype', 'registered'],
  gstin: ['gstin', 'gstno', 'gstnumber', 'gstinuin', 'gstinno', 'gstinnumber', 'gstidentificationnumber', 'tinnumber', 'tinno', 'taxno', 'taxnumber', 'vatno', 'gstregistrationno', 'partygstin', 'customergstin'],
  pan: ['pan', 'panno', 'pannumber', 'pancardno', 'itpan'],
  type: ['type', 'itemtype', 'producttype', 'goodsorservice', 'category'],
  unit: ['unit', 'uom', 'unitofmeasure', 'baseunit', 'unitname', 'itemunit', 'unitid', 'baseuom', 'primaryunit', 'usageunit'],
  hsnsac: ['hsnsac', 'hsn', 'hsncode', 'saccode', 'hsnsaccode', 'itemhsn', 'hsnsacno', 'hsnno', 'sac'],
  gstcode: ['gstcode', 'taxcode', 'gst', 'gstrate', 'taxrate', 'taxname', 'itemtax', 'taxid', 'salestax', 'intrastatetaxrate', 'gstpercent', 'tax'],
  sellable: ['sellable', 'forsale', 'sale', 'issellable', 'canbesold'],
  purchasable: ['purchasable', 'forpurchase', 'purchase', 'ispurchasable', 'canbepurchased'],
  categorycode: ['categorycode', 'category', 'categoryname', 'itemcategory', 'itemgroup', 'group', 'stockgroup', 'productcategory', 'parent'],
  brand: ['brand', 'brandname', 'manufacturer', 'make'],
  mrp: ['mrp', 'maxretailprice', 'maximumretailprice', 'retailprice', 'itemmrp'],
}

const synonymsOf = (f: TargetField): string[] => [norm(f.key), norm(f.label), ...(SYNONYMS[f.key] ?? []).map(norm), ...(f.synonyms ?? []).map(norm)]

/** How well a column name suits a field: 3 for a known name, 1 for a partial match, 0 for no match. */
export function scoreColumn(column: string, f: TargetField): number {
  const c = norm(column); if (!c) return 0
  const syn = synonymsOf(f)
  if (syn.includes(c)) return 3 - (syn.indexOf(c) > 1 ? 0.2 : 0)
  // an id column ("unit_id") is a number pointing elsewhere: weaker than a name
  const stripped = c.replace(/^(kb|tbl|name|item|party|ledger)+/, '').replace(/(id|no|number)$/, '')
  if (stripped.length >= 3 && syn.includes(stripped)) return 2
  for (const s of syn) if (s.length >= 4 && c.length >= 4 && (c.includes(s) || s.includes(c))) return 1
  return 0
}

/** The best column for each field, each column used once. Fields with no good match are left out. */
export function autoMap(columns: string[], fields: TargetField[]): Record<string, number> {
  const pairs: { f: string; i: number; s: number; order: number }[] = []
  fields.forEach((f, order) => columns.forEach((c, i) => { const s = scoreColumn(c, f); if (s > 0) pairs.push({ f: f.key, i, s, order }) }))
  pairs.sort((a, b) => b.s - a.s || a.order - b.order || a.i - b.i)
  const out: Record<string, number> = {}; const taken = new Set<number>()
  for (const p of pairs) if (out[p.f] === undefined && !taken.has(p.i)) { out[p.f] = p.i; taken.add(p.i) }
  return out
}

/** How well a whole table suits an import: the fields it fills (required ones count double), plus a nudge when the table's name fits. */
export function scoreTable(t: SourceTable, fields: TargetField[], hints: string[]): number {
  const m = autoMap(t.columns, fields)
  let s = 0; for (const f of fields) if (m[f.key] !== undefined) s += f.required ? 4 : 1
  const n = norm(t.name); if (hints.some((h) => n.includes(h))) s += 3
  return t.rows.length === 0 ? 0 : s
}

/** A code made from a name: letters and digits, upper case, short, and different from every code already used. */
export function codeFromName(name: string, used: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'ITEM'
  let code = base; let n = 1
  while (used.has(code.toLowerCase())) code = `${base.slice(0, 36 - String(++n).length)}-${n}`
  used.add(code.toLowerCase()); return code
}
