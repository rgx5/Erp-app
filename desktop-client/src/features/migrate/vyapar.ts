import { isValidGstin, STATES } from '@/domain/india'
import { codeFromName } from '@/features/import/mapping'
import type { ImportSource } from '@/features/import/readers'

/**
 * Reads a Vyapar backup (.vyb from the phone app, .vyp from the desktop app: both are SQLite databases) into plain records. Nothing here talks to the
 * server: it only turns Vyapar's tables into what this product needs, and says what it could not use.
 */
export interface VyFirm { name: string; email: string; phone: string; address: string; gstin: string; state: string; pincode: string; bankName: string; bankAccount: string; ifsc: string }
export interface VyUnit { id: number; name: string; shortName: string }
export interface VyTax { id: number; name: string; rate: number; kind: 'group' | 'component' | 'exempt' }
export interface VyParty { id: number; name: string; code: string; phone: string; email: string; gstin: string; stateCode: string; address: string; pincode: string; creditLimit: number; balance: number; active: boolean; isCustomer: boolean; isSupplier: boolean; termsId: number | null }
export interface VyItem { id: number; name: string; code: string; service: boolean; unitId: number | null; hsn: string; taxId: number | null; mrp: number; salePrice: number; purchasePrice: number; priceWithTax: boolean; stock: number; stockValue: number; categoryId: number | null; description: string; active: boolean }
export interface VyBank { id: number; name: string; bankName: string; accountNumber: string; ifsc: string; holder: string; upi: string; opening: number; openingDate: string }
export interface VyTerm { id: number; name: string; days: number }
export interface VyData {
  firm: VyFirm | null
  units: VyUnit[]; taxes: VyTax[]; categories: { id: number; name: string }[]; terms: VyTerm[]
  parties: VyParty[]; items: VyItem[]; banks: VyBank[]
  expenseCategories: string[]
  /** How many documents of each kind the file holds (they are counted, not imported: see the plan). */
  documents: { kind: string; count: number; total: number }[]
  firstDate: string | null; lastDate: string | null
  warnings: string[]
}

type Row = Record<string, string>
const rowsOf = (src: ImportSource, table: string): Row[] => {
  const t = src.tables.find((x) => x.name === table); if (!t) return []
  return t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i] ?? ''])))
}
const num = (v: string | undefined): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const int = (v: string | undefined): number | null => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null }
const clean = (v: string | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim()

export const isVyapar = (src: ImportSource): boolean => ['kb_firms', 'kb_names', 'kb_items', 'kb_transactions'].every((t) => src.tables.some((x) => x.name === t))

/** Vyapar's transaction kinds (kb_transactions.txn_type). Those on the selling side make a party a customer; on the buying side, a supplier. */
export const TXN_KINDS: Record<number, { label: string; side: 'sell' | 'buy' | 'none' }> = {
  1: { label: 'Sale invoices', side: 'sell' }, 2: { label: 'Purchase bills', side: 'buy' }, 3: { label: 'Payments received', side: 'sell' }, 4: { label: 'Payments made', side: 'buy' },
  21: { label: 'Sale returns (credit notes)', side: 'sell' }, 23: { label: 'Purchase returns (debit notes)', side: 'buy' }, 24: { label: 'Sale orders', side: 'sell' },
  27: { label: 'Estimates and quotations', side: 'sell' }, 28: { label: 'Purchase orders', side: 'buy' }, 30: { label: 'Delivery challans', side: 'sell' },
}
export const kindLabel = (t: number): string => TXN_KINDS[t]?.label ?? `Other (type ${t})`

const stateCodeOf = (name: string): string => {
  const n = name.toLowerCase().replace(/[^a-z]/g, ''); if (!n) return ''
  return STATES.find((s) => s.name.toLowerCase().replace(/[^a-z]/g, '') === n)?.code ?? ''
}

export function parseVyapar(src: ImportSource): VyData {
  const warnings: string[] = []
  const firmRow = rowsOf(src, 'kb_firms')[0]
  const firm: VyFirm | null = firmRow ? {
    name: clean(firmRow['firm_name']), email: clean(firmRow['firm_email']), phone: clean(firmRow['firm_phone']), address: clean(firmRow['firm_address']), gstin: clean(firmRow['firm_gstin_number']).toUpperCase(),
    state: clean(firmRow['firm_state']), pincode: clean(firmRow['firm_pincode']), bankName: clean(firmRow['firm_bank_name']), bankAccount: clean(firmRow['firm_bank_account_number']), ifsc: clean(firmRow['firm_bank_ifsc_code']),
  } : null
  if (rowsOf(src, 'kb_firms').length > 1) warnings.push('This file has more than one business. Only the first one is brought in; migrate the others separately into their own business.')

  const units: VyUnit[] = rowsOf(src, 'kb_item_units').flatMap((r) => { const id = int(r['unit_id']); return id ? [{ id, name: clean(r['unit_name']), shortName: clean(r['unit_short_name']) }] : [] })
  const taxes: VyTax[] = rowsOf(src, 'kb_tax_code').flatMap((r) => {
    const id = int(r['tax_code_id']); if (!id) return []
    const type = r['tax_code_type']; const rateType = r['tax_rate_type']
    const kind: VyTax['kind'] = clean(r['tax_code_name']).toLowerCase().startsWith('exempt') ? 'exempt' : type === '1' ? 'group' : 'component'
    void rateType
    return [{ id, name: clean(r['tax_code_name']), rate: num(r['tax_rate']), kind }]
  })
  const categories = rowsOf(src, 'kb_item_categories').flatMap((r) => { const id = int(r['item_category_id']); return id && clean(r['item_category_name']) ? [{ id, name: clean(r['item_category_name']) }] : [] })
  const catOfItem = new Map(rowsOf(src, 'kb_item_categories_mapping').map((r) => [r['item_id'], int(r['category_id'])]))
  const terms: VyTerm[] = rowsOf(src, 'kb_payment_terms').flatMap((r) => { const id = int(r['payment_term_id']); return id ? [{ id, name: clean(r['term_name']), days: Math.max(0, Math.round(num(r['term_days']))) }] : [] })

  // who has traded how: customers have selling documents, suppliers have buying ones
  const sells = new Set<string>(); const buys = new Set<string>()
  const docs = new Map<number, { count: number; total: number }>(); let first: string | null = null; let last: string | null = null
  for (const t of rowsOf(src, 'kb_transactions')) {
    const type = Number(t['txn_type']); const side = TXN_KINDS[type]?.side
    if (side === 'sell') sells.add(t['txn_name_id'] ?? ''); if (side === 'buy') buys.add(t['txn_name_id'] ?? '')
    const d = docs.get(type) ?? { count: 0, total: 0 }; d.count++; d.total += num(t['txn_cash_amount']) + num(t['txn_balance_amount']); docs.set(type, d)
    const date = clean(t['txn_date']).slice(0, 10); if (date) { if (!first || date < first) first = date; if (!last || date > last) last = date }
  }

  const used = new Set<string>()
  const parties: VyParty[] = []
  const expenseCategories: string[] = []
  let badGstin = 0
  for (const r of rowsOf(src, 'kb_names')) {
    const id = int(r['name_id']); const name = clean(r['full_name']); if (!id || !name) continue
    if (r['name_type'] === '2') { expenseCategories.push(name); continue } // type 2 are expense heads, not people
    let gstin = clean(r['name_gstin_number']).toUpperCase().replace(/\s/g, '')
    if (gstin && !isValidGstin(gstin)) { badGstin++; gstin = '' }
    const stateCode = gstin ? gstin.slice(0, 2) : stateCodeOf(clean(r['name_state']))
    const sell = sells.has(String(id)); const buy = buys.has(String(id))
    const balance = num(r['amount'])
    const pin = clean(r['pincode']) || /\b[1-9][0-9]{5}\b/.exec(clean(r['address']))?.[0] || ''
    parties.push({
      id, name, code: codeFromName(name, used), phone: clean(r['phone_number']).replace(/[^0-9+() -]/g, ''), email: clean(r['email']), gstin, stateCode, address: clean(r['address']), pincode: /^[1-9][0-9]{5}$/.test(pin) ? pin : '',
      creditLimit: r['credit_limit_enabled'] === '1' ? num(r['credit_limit']) : 0, balance, active: r['name_is_active'] !== '0',
      // a party with no history at all is a customer (the common case), unless it is owed money by the business
      isCustomer: sell || (!buy && balance >= 0), isSupplier: buy || (!sell && balance < 0), termsId: null,
    })
  }
  if (badGstin) warnings.push(`${badGstin} ${badGstin === 1 ? 'party has' : 'parties have'} a GSTIN that does not pass the check, so it was left out (the party itself is still brought in).`)

  const itemUsed = new Set<string>()
  const items: VyItem[] = []
  for (const r of rowsOf(src, 'kb_items')) {
    const id = int(r['item_id']); const name = clean(r['item_name']); if (!id || !name) continue
    const codeRaw = clean(r['item_code'])
    items.push({
      id, name, code: codeRaw && !itemUsed.has(codeRaw.toLowerCase()) ? (itemUsed.add(codeRaw.toLowerCase()), codeRaw.toUpperCase().replace(/[^A-Z0-9._/-]+/g, '-').slice(0, 40)) : codeFromName(name, itemUsed),
      service: r['item_type'] === '2', unitId: int(r['base_unit_id']), hsn: clean(r['item_hsn_sac_code']).replace(/[\s.-]/g, ''), taxId: int(r['item_tax_id']), mrp: num(r['item_mrp']),
      salePrice: num(r['item_sale_unit_price']), purchasePrice: num(r['item_purchase_unit_price']), priceWithTax: r['item_tax_type'] === '1', stock: num(r['item_stock_quantity']), stockValue: num(r['item_stock_value']),
      categoryId: catOfItem.get(String(id)) ?? int(r['category_id']), description: clean(r['item_description']), active: r['item_is_active'] !== '0',
    })
  }

  const banks: VyBank[] = rowsOf(src, 'kb_paymentTypes').flatMap((r) => {
    const id = int(r['paymentType_id']); if (!id || r['paymentType_type'] !== 'BANK') return []
    return [{ id, name: clean(r['paymentType_name']), bankName: clean(r['paymentType_bankName']), accountNumber: clean(r['paymentType_accountNumber']), ifsc: clean(r['pt_bank_ifsc_code']), holder: clean(r['pt_bank_account_holder_name']), upi: clean(r['pt_bank_upi_id']), opening: num(r['paymentType_opening_balance']), openingDate: clean(r['paymentType_opening_date']).slice(0, 10) }]
  })

  return {
    firm, units, taxes, categories, terms, parties, items, banks, expenseCategories,
    documents: [...docs].sort((a, b) => a[0] - b[0]).map(([t, d]) => ({ kind: kindLabel(t), count: d.count, total: Math.round(d.total * 100) / 100 })),
    firstDate: first, lastDate: last, warnings,
  }
}
