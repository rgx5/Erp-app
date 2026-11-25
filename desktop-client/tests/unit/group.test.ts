import { describe, expect, it } from 'vitest'
import type { TrialBalance } from '@/api/schemas'
import { groupSummary, groupTrialBalance } from '@/features/accounting/group'

const tb = (rows: [string, string, string, string, string][]): TrialBalance => ({ from: '2026-04-01', to: '2026-09-30', balanced: true, rows: rows.map(([code, name, type, dr, cr]) => ({ accountId: code, code, name, type, openingDebit: '0', openingCredit: '0', debit: '0', credit: '0', closingDebit: dr, closingCredit: cr })), totals: { openingDebit: '0', openingCredit: '0', debit: '0', credit: '0', closingDebit: '0', closingCredit: '0' } })
describe('group statements', () => {
  const a = tb([['1130', 'Receivables', 'asset', '500', '0'], ['4100', 'Sales', 'income', '0', '1000'], ['5100', 'Cost of goods', 'expense', '400', '0'], ['3100', 'Capital', 'equity', '0', '0'], ['1110', 'Cash', 'asset', '100', '0']])
  const b = tb([['2110', 'Payables', 'liability', '0', '500'], ['4100', 'Sales', 'income', '0', '300'], ['5100', 'Cost of goods', 'expense', '700', '0'], ['1110', 'Cash', 'asset', '100', '0']])
  it('puts the companies side by side, matching accounts by code', () => {
    const g = groupTrialBalance(['A', 'B'], [a, b])
    expect(g.rows.find((r) => r.code === '4100')).toMatchObject({ perCompany: [-1000, -300], total: -1300 })
    expect(g.rows.find((r) => r.code === '1130')).toMatchObject({ perCompany: [500, 0], total: 500 }); expect(g.rows.map((r) => r.code)).toEqual(['1110', '1130', '2110', '3100', '4100', '5100'])
  })
  it('works out the group once inter-company balances are taken out', () => {
    const g = groupTrialBalance(['A', 'B'], [a, b])
    const none = groupSummary(g.rows, new Set()); expect(none).toMatchObject({ income: 1300, expense: 1100, profit: 200, balanced: true })
    // A's receivable from B and B's payable to A cancel each other
    expect(groupSummary(g.rows, new Set(['1130', '2110']))).toMatchObject({ profit: 200, balanced: true })
    expect(groupSummary(g.rows, new Set(['1130'])).balanced).toBe(false) // one side only
  })
})
