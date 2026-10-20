/**
 * Accounting — what this module adds to the app: the Accounts app's books, statements and year-end tools, the Reports hub, a
 * Home notice, and a ledger balance on customer and supplier pages. The ledger itself is never stored: it is computed from
 * every document by `ledger.ts`, using the posting rules in `postings.ts` (core documents) and from other modules.
 *   src/app/m/accounting/…  its screens
 */
import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { GST_PAYMENT_CATEGORY } from '@/domain/analytics'
import { inr } from '@/domain/money'
import { listOf } from '@/data/state'
import { useApp } from '@/data/store'
import { Section } from '@/ui/blocks'
import { Card, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { BookOpen, ChartLine, ChevronRight, Download, FileText, Landmark, Lock, ReceiptText, Scale, Users } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { registerModule, registerPanel } from '../registry'
import type { PartyType } from '../postings'
import { EXPENSE_PREFIX } from './chart'
import { buildLedger, partyLedger } from './ledger'
import './replication'
import './postings'

registerModule({
  id: 'accounting', name: 'Accounts', tagline: 'Expenses, ledgers, statements and tax', icon: Landmark, tone: 'success', order: 40,
  features: [
    { id: 'acc-vouchers', label: 'Vouchers', sub: 'Receipts, payments, journals and transfers', icon: ReceiptText, tone: 'primary', to: '/m/accounting/vouchers', perm: 'accounting', section: 'Books', badge: (s) => listOf(s.vouchers).length || null },
    { id: 'acc-parties', label: 'Customer & supplier ledgers', sub: 'Who owes us and whom we owe', icon: Users, tone: 'accent', to: '/m/accounting/parties', perm: 'accounting', section: 'Books' },
    { id: 'acc-daybook', label: 'Day book', sub: 'Every entry, a day at a time', icon: BookOpen, tone: 'primary', to: '/m/accounting/day-book', perm: 'accounting', section: 'Books' },
    { id: 'acc-cashbook', label: 'Cash book', sub: 'Cash in hand with a running balance', icon: ReceiptText, tone: 'success', to: '/m/accounting/cash-book', perm: 'accounting', section: 'Books' },
    { id: 'acc-chart', label: 'Chart of accounts', sub: 'Accounts, opening balances and numbers', icon: FileText, tone: 'primary', to: '/m/accounting/chart', perm: 'accounting', section: 'Books' },
    { id: 'acc-trial', label: 'Trial balance', sub: 'Every account’s balance; debits equal credits', icon: Scale, tone: 'primary', to: '/m/accounting/trial-balance', perm: 'accounting', section: 'Statements' },
    { id: 'acc-pl', label: 'Profit & loss', sub: 'Income, cost of sales and expenses', icon: ChartLine, tone: 'success', to: '/m/accounting/profit-loss', perm: 'accounting', section: 'Statements' },
    { id: 'acc-bs', label: 'Balance sheet', sub: 'What the business owns and owes', icon: Scale, tone: 'accent', to: '/m/accounting/balance-sheet', perm: 'accounting', section: 'Statements' },
    { id: 'acc-years', label: 'Years & locks', sub: 'Financial year, closing, period locks', icon: Lock, tone: 'warning', to: '/m/accounting/years', perm: 'accounting', section: 'Year-end' },
    { id: 'acc-tally', label: 'Tally export', sub: 'Ledgers and vouchers for Tally Prime', icon: Download, tone: 'primary', to: '/m/accounting/tally', perm: 'accounting', section: 'Year-end' },
  ],
  reports: [
    { id: 'rep-trial', label: 'Trial balance', sub: 'Every account, debit and credit', icon: Scale, tone: 'primary', to: '/m/accounting/trial-balance', group: 'Accounts', perm: 'accounting' },
    { id: 'rep-pl', label: 'Profit & loss', sub: 'From the books, with cost of sales', icon: ChartLine, tone: 'success', to: '/m/accounting/profit-loss', group: 'Accounts', perm: 'accounting' },
    { id: 'rep-bs', label: 'Balance sheet', sub: 'Assets, liabilities and equity', icon: Scale, tone: 'accent', to: '/m/accounting/balance-sheet', group: 'Accounts', perm: 'accounting' },
    { id: 'rep-daybook', label: 'Day book', sub: 'All entries by day', icon: BookOpen, tone: 'primary', to: '/m/accounting/day-book', group: 'Accounts', perm: 'accounting' },
    { id: 'rep-cashbook', label: 'Cash book', sub: 'Cash in hand', icon: ReceiptText, tone: 'success', to: '/m/accounting/cash-book', group: 'Accounts', perm: 'accounting' },
    { id: 'rep-parties', label: 'Party ledgers', sub: 'Customer and supplier accounts', icon: Users, tone: 'accent', to: '/m/accounting/parties', group: 'Accounts', perm: 'accounting' },
  ],
  notices: [
    // Cheap on purpose (runs on every change): expense categories the saved chart has no account for sit in Suspense.
    (s, now) => {
      void now
      const accounts = listOf(s.accounts)
      if (!accounts.length) return null
      const keys = new Set(accounts.map((a) => a.key))
      const missing = new Set<string>()
      for (const e of listOf(s.expenses)) if (e.category !== GST_PAYMENT_CATEGORY && !keys.has(`${EXPENSE_PREFIX}${e.category || 'Other'}`)) missing.add(e.category || 'Other')
      return missing.size ? { id: 'acc-unmapped', tone: 'warning', title: `${missing.size} expense ${missing.size === 1 ? 'category has' : 'categories have'} no account`, body: 'Those expenses sit in Suspense until the chart has an account for them', action: 'Fix', to: '/m/accounting/chart' } : null
    },
  ],
})

/** What the books say about this person, with a link to their ledger. */
function LedgerBalance({ type, id }: { type: PartyType; id: string }) {
  const { c } = useTheme()
  const router = useRouter()
  const data = useApp((s) => s.data)
  const p = useMemo(() => partyLedger(buildLedger(data), data, type, id), [data, type, id])
  if (!p.rows.length && !p.closing) return null
  return (
    <Section title="In the books" style={{ marginTop: 6 }}>
      <Card padded={false}>
        <Tap onPress={() => router.push({ pathname: '/m/accounting/parties/[type]/[id]', params: { type, id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 }}>
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{type === 'supplier' ? 'We owe' : 'Owes us'}</T>
            <T v="caption" tone="mute">{p.rows.length} {p.rows.length === 1 ? 'entry' : 'entries'} · ledger</T>
          </View>
          <T v="num">{inr(p.closing, 2)}</T>
          <ChevronRight size={16} color={c.inkMute} />
        </Tap>
      </Card>
    </Section>
  )
}
registerPanel({ id: 'accounting.customer-ledger', slot: 'customer', order: 30, perm: 'accounting', needsKosh: true, component: ({ customer }) => <LedgerBalance type="customer" id={customer.id} /> })
registerPanel({ id: 'accounting.supplier-ledger', slot: 'supplier', order: 30, perm: 'accounting', needsKosh: true, component: ({ supplier }) => <LedgerBalance type="supplier" id={supplier.id} /> })

