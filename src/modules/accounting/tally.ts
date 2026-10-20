import { listOf, type DataState } from '@/data/state'
import { round2 } from '@/domain/money'
import type { PartyType } from '../postings'
import { buildLedger } from './ledger'
import { isExpenseKey } from './chart'
import type { Account } from './types'

/**
 * Tally Prime import files, built from the books.
 *
 * Two files, because Tally imports masters and vouchers separately: import the **masters** first (ledgers), then the
 * **vouchers**. What this export is — and is not:
 *   • accounting vouchers only (Sales, Credit Note, Purchase, Receipt, Payment, Journal, Contra): every voucher balances;
 *   • one Tally ledger per account, and one per customer / supplier / employee under Sundry Debtors / Creditors, so Tally's own
 *     party ledgers line up with this app's;
 *   • NO inventory (stock items, quantities) and NO GST register detail (HSN, GSTIN, place of supply, bill-wise allocations):
 *     GST appears as plain tax ledgers under Duties & Taxes, so GSTR filing from Tally needs its own entry of those details;
 *   • one currency (INR), and the company must already exist in Tally with the same name;
 *   • opening balances are exported on the account masters; check them against Tally's own before importing.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim()
const ymd = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` }
const money = (n: number) => round2(n).toFixed(2)

const GROUP_BY_KEY: Record<string, string> = {
  cash: 'Cash-in-Hand', bank: 'Bank Accounts', upi: 'Bank Accounts', card: 'Bank Accounts', wallet: 'Bank Accounts',
  receivables: 'Sundry Debtors', payables: 'Sundry Creditors', inventory: 'Stock-in-Hand',
  gst_input_cgst: 'Duties & Taxes', gst_input_sgst: 'Duties & Taxes', gst_input_igst: 'Duties & Taxes',
  gst_output_cgst: 'Duties & Taxes', gst_output_sgst: 'Duties & Taxes', gst_output_igst: 'Duties & Taxes', gst_paid: 'Duties & Taxes',
  sales: 'Sales Accounts', sales_returns: 'Sales Accounts', purchases: 'Purchase Accounts', purchase_returns: 'Purchase Accounts',
  cogs: 'Direct Expenses', freight_in: 'Direct Expenses', stock_adjustments: 'Direct Expenses',
  advances_paid: 'Loans & Advances (Asset)', employee_advances: 'Loans & Advances (Asset)', suspense: 'Suspense A/c',
  owner_capital: 'Capital Account', drawings: 'Capital Account', retained_earnings: 'Reserves & Surplus',
  salary_payable: 'Current Liabilities', pf_payable: 'Duties & Taxes', esi_payable: 'Duties & Taxes', tds_payable: 'Duties & Taxes', professional_tax_payable: 'Duties & Taxes',
}

/** The Tally group an account belongs under. */
export function tallyGroup(a: Account): string {
  if (a.key && GROUP_BY_KEY[a.key]) return GROUP_BY_KEY[a.key]
  if (a.key && isExpenseKey(a.key)) return 'Indirect Expenses'
  switch (a.type) {
    case 'asset': return 'Current Assets'
    case 'liability': return 'Current Liabilities'
    case 'equity': return 'Capital Account'
    case 'income': return 'Indirect Incomes'
    default: return 'Indirect Expenses'
  }
}

const envelope = (report: string, company: string, messages: string) => `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>${report}</REPORTNAME>
    <STATICVARIABLES><SVCURRENTCOMPANY>${esc(clean(company))}</SVCURRENTCOMPANY></STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
${messages}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`

interface Names { account: Map<string, string>; party: (type: PartyType, id: string) => string; partyList: Array<{ name: string; group: string }> }

/** Names for ledgers. A person whose name equals an account's gets their role added, since Tally ledger names are unique. */
function namesFor(state: DataState, accounts: Account[]): Names {
  const account = new Map<string, string>()
  const used = new Set<string>()
  for (const a of accounts) { const n = clean(a.name); account.set(a.id, n); used.add(n.toLowerCase()) }
  const party = new Map<string, string>()
  const partyList: Names['partyList'] = []
  const add = (type: PartyType, id: string, raw: string, group: string) => {
    let n = clean(raw) || `${type} ${id}`
    if (used.has(n.toLowerCase())) n = `${n} (${type})`
    used.add(n.toLowerCase())
    party.set(`${type}:${id}`, n)
    partyList.push({ name: n, group })
  }
  for (const c of listOf(state.customers)) add('customer', c.id, c.name, 'Sundry Debtors')
  for (const s of listOf(state.suppliers)) add('supplier', s.id, s.name, 'Sundry Creditors')
  for (const u of listOf(state.users)) add('employee', u.id, u.name, 'Loans & Advances (Asset)')
  return { account, party: (t, id) => party.get(`${t}:${id}`) ?? `${t} ${id}`, partyList }
}

/** Ledger masters: every active account, and every customer, supplier and staff member. */
export function tallyMastersXml(state: DataState, company: string): { xml: string; ledgers: number } {
  const ledger = buildLedger(state)
  const accounts = ledger.chart.filter((a) => a.active)
  const names = namesFor(state, accounts)
  const parts: string[] = []
  for (const a of accounts) {
    const n = names.account.get(a.id)!
    // Tally writes a debit opening balance as a negative number.
    const open = a.openingBalance ? `<OPENINGBALANCE>${money(a.type === 'asset' || a.type === 'expense' ? -a.openingBalance : a.openingBalance)}</OPENINGBALANCE>` : ''
    parts.push(`    <TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(n)}" ACTION="Create"><NAME>${esc(n)}</NAME><PARENT>${esc(tallyGroup(a))}</PARENT>${open}</LEDGER></TALLYMESSAGE>`)
  }
  for (const p of names.partyList) {
    parts.push(`    <TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(p.name)}" ACTION="Create"><NAME>${esc(p.name)}</NAME><PARENT>${esc(p.group)}</PARENT></LEDGER></TALLYMESSAGE>`)
  }
  return { xml: envelope('All Masters', company, parts.join('\n')), ledgers: accounts.length + names.partyList.length }
}

const VOUCHER_TYPE: Record<string, string> = { receipt: 'Receipt', payment: 'Payment', journal: 'Journal', contra: 'Contra', closing: 'Journal' }

/** The Tally voucher type and number for the document a posting came from. */
function voucherMeta(state: DataState, coll: string | undefined, id: string | undefined): { type: string; number: string } {
  if (coll === 'bills' && id) {
    const b = state.bills[id]
    return { type: b && (b.refundOfBillId || b.total < 0) ? 'Credit Note' : 'Sales', number: b?.no ?? '' }
  }
  if (coll === 'purchases' && id) return { type: 'Purchase', number: state.purchases[id]?.no ?? '' }
  if (coll === 'expenses') return { type: 'Payment', number: '' }
  if (coll === 'vouchers' && id) { const v = state.vouchers[id]; return { type: VOUCHER_TYPE[v?.type ?? 'journal'] ?? 'Journal', number: v?.no ?? '' } }
  return { type: 'Journal', number: '' }
}

/** Accounting vouchers for the period. Every voucher's amounts net to zero; entries to the same ledger are combined. */
export function tallyVouchersXml(state: DataState, o: { company: string; from: number; to: number }): { xml: string; vouchers: number } {
  const ledger = buildLedger(state, { from: o.from, to: o.to })
  const names = namesFor(state, ledger.chart)
  const parts: string[] = []
  for (const p of ledger.postings) {
    const net = new Map<string, number>()
    for (const l of p.lines) {
      const name = l.party ? names.party(l.party.type, l.party.id) : names.account.get(l.accountId) ?? ''
      net.set(name, round2((net.get(name) ?? 0) + l.debit - l.credit))
    }
    const lines = [...net.entries()].filter(([, v]) => v !== 0)
    if (lines.length < 2) continue
    const meta = voucherMeta(state, p.sourceColl, p.sourceId)
    const entries = lines.map(([name, v]) => `     <ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${v > 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${money(v > 0 ? -v : -v)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join('\n')
    parts.push(`    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="${esc(meta.type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>${ymd(p.date)}</DATE>
     <VOUCHERTYPENAME>${esc(meta.type)}</VOUCHERTYPENAME>
     <VOUCHERNUMBER>${esc(clean(meta.number))}</VOUCHERNUMBER>
     <NARRATION>${esc(clean(p.memo))}</NARRATION>
${entries}
     </VOUCHER>
    </TALLYMESSAGE>`)
  }
  return { xml: envelope('Vouchers', o.company, parts.join('\n')), vouchers: parts.length }
}
