import { describe, expect, it } from 'vitest'
import { licensed } from '@/auth/permissions'
import { compareVersions } from '@/domain/version'
import { moduleOfPage } from '@/ui/nav'

const plan = (...modules: string[]) => ({ entitlements: { restricted: true, modules } })

describe('licence in the app', () => {
  it('shows everything when there is no licence record, and Core pages always', () => {
    expect(licensed({ entitlements: { restricted: false, modules: [] } }, 'payroll')).toBe(true)
    expect(licensed(undefined, 'payroll')).toBe(true)
    expect(licensed(plan('sales'), undefined)).toBe(true)
  })
  it('shows only the modules in the plan', () => {
    expect(licensed(plan('sales'), 'sales')).toBe(true)
    expect(licensed(plan('sales'), 'purchasing')).toBe(false)
  })
  it('maps each page to its module', () => {
    expect(moduleOfPage({ to: '/sales/invoices', section: 'Sales' })).toBe('sales')
    expect(moduleOfPage({ to: '/accounting/journals', section: 'Accounting' })).toBe('accounting')
    expect(moduleOfPage({ to: '/accounting/bank', section: 'Accounting' })).toBe('banking')
    expect(moduleOfPage({ to: '/accounting/expenses', section: 'Accounting' })).toBe('pos')
    expect(moduleOfPage({ to: '/gst', section: 'Accounting' })).toBe('gst')
    expect(moduleOfPage({ to: '/masterdata/items', section: 'Master data' })).toBeUndefined()
    expect(moduleOfPage({ to: '/' })).toBeUndefined()
  })
  it('compares versions by number, not by text', () => {
    expect(compareVersions('1.4.10', '1.4.9')).toBeGreaterThan(0)
    expect(compareVersions('1.4.0', '1.4.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })
})
