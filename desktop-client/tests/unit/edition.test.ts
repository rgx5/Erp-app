import { describe, expect, it } from 'vitest'
import { editionOf, isStarter } from '../../src/auth/edition'
import { NAV, visibleNav } from '../../src/ui/nav'

const me = (modules: string[] | null) => ({ entitlements: modules === null ? { restricted: false, modules: [] } : { restricted: true, modules } })
const labels = (m: ReturnType<typeof me>) => visibleNav(NAV, () => true, m).map((n) => n.label)

describe('editions', () => {
  it('are told from the licensed modules, small shop to manufacturer', () => {
    expect(editionOf(me(['sales', 'inventory', 'pos']))).toBe('starter')
    expect(editionOf(me(['sales', 'inventory']))).toBe('starter')
    expect(editionOf(me(['sales', 'inventory', 'pos', 'purchasing', 'accounting', 'gst']))).toBe('growth')
    expect(editionOf(me(['sales', 'inventory', 'pos', 'purchasing', 'accounting', 'approvals', 'payroll']))).toBe('enterprise')
    expect(editionOf(me(['sales', 'inventory', 'purchasing', 'accounting', 'manufacturing']))).toBe('manufacturing')
    expect(editionOf(me(null))).toBe('full'); expect(editionOf(null)).toBe('full'); expect(isStarter(me(['sales', 'inventory', 'pos']))).toBe(true); expect(isStarter(me(null))).toBe(false)
  })
  it('give a small shop a short menu: sales, stock, counter and the basics, without accounts, buying or the advanced screens', () => {
    const l = labels(me(['sales', 'inventory', 'pos']))
    for (const want of ['Dashboard', 'Setup checklist', 'Invoices', 'Receipts', 'Stock on hand', 'Counter', 'Items', 'Customers', 'Users']) expect(l, want).toContain(want)
    for (const hide of ['Purchase orders', 'Journal entries', 'GST returns', 'Payroll runs', 'Work orders', 'Approvals', 'Tax codes', 'Units', 'API keys', 'Audit log', 'Batches and serials', 'Valuation', 'Transfers']) expect(l, hide).not.toContain(hide)
  })
  it('show the advanced screens again as the plan grows, and everything with no restrictions', () => {
    expect(labels(me(['sales', 'inventory', 'pos', 'purchasing', 'accounting']))).toEqual(expect.arrayContaining(['Purchase orders', 'Journal entries', 'Tax codes', 'Valuation', 'Audit log']))
    expect(labels(me(null))).toEqual(expect.arrayContaining(['Work orders', 'Payroll runs', 'Approvals', 'Batches and serials']))
    expect(labels(me(['sales', 'inventory', 'pos', 'purchasing', 'accounting', 'manufacturing']))).toContain('Work orders')
  })
})
