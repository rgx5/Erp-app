import { billInput, line } from '@/data/__tests__/helpers'
import { processReturn, saveBill } from '@/data/ops'
import { rig, actorWith } from '@/replication/testkit'
import { applyMutations } from '@/replication'
import { listOf, type DataState } from '@/data/state'
import { commissionCsvRows, commissionReport, monthsIn, rateFor, ruleFor } from '../logic/commissions'
import { deleteCommissionRule, deleteSalesTarget, saveCommissionRule, saveSalesTarget, type RuleDraft } from '../ops'
import type { CommissionRule } from '../types'
import { baseState, commit, ctx, NOW } from './helpers'

const rule = (over: Partial<CommissionRule> = {}): CommissionRule => ({ id: 'r1', name: 'Everything', staffId: '', scope: 'all', basis: 'pct', rate: 2, active: true, ...over })
const draft = (over: Partial<RuleDraft> = {}): RuleDraft => ({ name: 'Everything', staffId: '', scope: 'all', basis: 'pct', rate: 2, active: true, ...over })
const from = new Date('2026-10-01T00:00:00').getTime()
const to = new Date('2026-10-31T23:59:59').getTime()

/** A bill of `qty` shirts (v1) sold by `staff`. */
function sell(s: DataState, staff: string, qty: number, at = NOW): { s: DataState; taxable: number; billId: string } {
  const input = billInput(s, [line(s.variants.v1, qty)], { cashierId: staff, soldBy: staff })
  input.items = input.items.map((i) => ({ ...i, soldBy: staff }))
  const r = saveBill(s, { ...input, date: at }, ctx({ now: at, userId: staff }))
  return { s: commit(s, r), taxable: r.bill.items.reduce((t, i) => t + i.taxable, 0), billId: r.bill.id }
}

describe('commission rules', () => {
  test('the most specific rule wins: item over category over everything; a person’s own over everyone’s', () => {
    const rules = [rule(), rule({ id: 'r2', scope: 'category', categoryId: 'cat_mshirt', rate: 3 }), rule({ id: 'r3', scope: 'item', productId: 'p1', rate: 4 }), rule({ id: 'r4', staffId: 'u_cash', rate: 1 }), rule({ id: 'r5', active: false, rate: 99 })]
    expect(ruleFor(rules, 'u_owner', 'p1', 'cat_mshirt')?.id).toBe('r3')
    expect(ruleFor(rules, 'u_owner', 'p9', 'cat_mshirt')?.id).toBe('r2')
    expect(ruleFor(rules, 'u_owner', 'p9', 'other')?.id).toBe('r1')
    expect(ruleFor(rules, 'u_cash', 'p9', 'other')?.id).toBe('r4') // a rule for the person outranks any shop-wide one
    expect(ruleFor([rule({ active: false })], 'u_cash', 'p1', undefined)).toBeNull()
  })

  test('slabs: the highest slab reached pays; per-piece rules ignore them', () => {
    const r = rule({ rate: 2, slabs: [{ minAchievementPct: 100, rate: 3 }, { minAchievementPct: 120, rate: 5 }] })
    expect([rateFor(r, null), rateFor(r, 50), rateFor(r, 100), rateFor(r, 119.9), rateFor(r, 130)]).toEqual([2, 2, 3, 3, 5])
    expect(rateFor({ ...r, basis: 'per_piece', rate: 10 }, 200)).toBe(10)
  })

  test('months a period touches', () => {
    expect(monthsIn(from, to)).toEqual(['2026-10'])
    expect(monthsIn(new Date('2026-12-15').getTime(), new Date('2027-02-02').getTime())).toEqual(['2026-12', '2027-01', '2027-02'])
  })

  test('saving checks the rule and a target is one per person per month', () => {
    const s = baseState()
    expect(() => saveCommissionRule(s, draft({ name: ' ' }), undefined, ctx())).toThrow('name')
    expect(() => saveCommissionRule(s, draft({ rate: -1 }), undefined, ctx())).toThrow('negative')
    expect(() => saveCommissionRule(s, draft({ rate: 120 }), undefined, ctx())).toThrow('above 100')
    expect(() => saveCommissionRule(s, draft({ scope: 'category' }), undefined, ctx())).toThrow('category')
    expect(() => saveCommissionRule(s, draft({ scope: 'item', productId: 'zz' }), undefined, ctx())).toThrow('item')
    expect(() => saveCommissionRule(s, draft({ staffId: 'ghost' }), undefined, ctx())).toThrow('no longer exists')
    expect(() => saveCommissionRule(s, draft(), 'missing', ctx())).toThrow('no longer exists')
    const r = saveCommissionRule(s, draft({ scope: 'item', productId: 'p1', slabs: [] }), undefined, ctx()).rule
    expect(r.slabs).toBeUndefined()

    expect(() => saveSalesTarget(s, { staffId: 'u_cash', month: '2026-13', amount: 1 }, ctx())).toThrow('2026-10')
    expect(() => saveSalesTarget(s, { staffId: 'u_cash', month: '2026-10', amount: 0 }, ctx())).toThrow('target amount')
    expect(() => saveSalesTarget(s, { staffId: 'ghost', month: '2026-10', amount: 5 }, ctx())).toThrow('salesperson')
    let t = saveSalesTarget(s, { staffId: 'u_cash', month: '2026-10', amount: 50000 }, ctx())
    const s2 = commit(s, t)
    const again = saveSalesTarget(s2, { staffId: 'u_cash', month: '2026-10', amount: 60000 }, ctx())
    expect(again.target.id).toBe(t.target.id)
    expect(listOf(commit(s2, again).salesTargets)).toHaveLength(1)
    expect(deleteSalesTarget(s2, t.target.id, ctx()).changes.del!.salesTargets).toEqual([t.target.id])
    expect(() => deleteSalesTarget(s, 'nope', ctx())).toThrow('no longer exists')
  })
})

describe('commission report', () => {
  test('sales are credited to whoever sold them, GST excluded, and the rule pays on that', () => {
    let s = baseState()
    s = commit(s, saveCommissionRule(s, draft({ rate: 2 }), undefined, ctx()))
    const a = sell(s, 'u_owner', 2)
    const b = sell(a.s, 'u_cash', 1, NOW + 1000)
    const rep = commissionReport(b.s, from, to)
    const owner = rep.rows.find((r) => r.staffId === 'u_owner')!
    const cash = rep.rows.find((r) => r.staffId === 'u_cash')!
    expect(owner).toMatchObject({ bills: 1, pieces: 2, sales: Math.round(a.taxable * 100) / 100, name: 'Asha Owner', achievementPct: null, target: 0 })
    expect(owner.commission).toBe(Math.round(a.taxable * 2) / 100)
    expect(cash.pieces).toBe(1)
    expect(rep.totalSales).toBeCloseTo(a.taxable + b.taxable, 1)
    expect(rep.rows[0].staffId).toBe('u_owner') // most sales first
  })

  test('outside the period or on a parked bill counts for nothing; a return takes it back', () => {
    let s = baseState()
    s = commit(s, saveCommissionRule(s, draft({ rate: 10 }), undefined, ctx()))
    const sold = sell(s, 'u_cash', 2)
    s = sold.s
    expect(commissionReport(s, from, to).rows).toHaveLength(1)
    expect(commissionReport(s, from - 40 * 86_400_000, from - 1).rows).toHaveLength(0)
    const ret = processReturn(s, sold.billId, [{ variantId: 'v1', qty: 1 }], 'cash', ctx({ now: NOW + 5000 }))
    s = commit(s, ret)
    const row = commissionReport(s, from, to).rows[0]
    expect(row.pieces).toBe(1)
    expect(row.bills).toBe(1)
    expect(row.sales).toBeLessThan(sold.taxable)
    expect(row.sales).toBeGreaterThan(0)
  })

  test('per-piece rules pay by the piece; a slab rate needs a target and rewards beating it', () => {
    let s = baseState()
    s = commit(s, saveCommissionRule(s, draft({ name: 'Per piece', basis: 'per_piece', rate: 25, staffId: 'u_owner' }), undefined, ctx()))
    s = commit(s, saveCommissionRule(s, draft({ name: 'Slabs', staffId: 'u_cash', rate: 1, slabs: [{ minAchievementPct: 100, rate: 4 }] }), undefined, ctx({ now: NOW + 1 })))
    const a = sell(s, 'u_owner', 3)
    const b = sell(a.s, 'u_cash', 4, NOW + 10)
    s = b.s
    s = commit(s, saveSalesTarget(s, { staffId: 'u_cash', month: '2026-10', amount: 1000 }, ctx()))
    const rep = commissionReport(s, from, to)
    expect(rep.rows.find((r) => r.staffId === 'u_owner')!.commission).toBe(75)
    const cash = rep.rows.find((r) => r.staffId === 'u_cash')!
    expect(cash.achievementPct).toBeGreaterThanOrEqual(100)
    expect(cash.lines[0]).toMatchObject({ ruleName: 'Slabs', rate: 4 })
    expect(cash.commission).toBeCloseTo((b.taxable * 4) / 100, 1)
  })

  test('someone with a target but no sales yet is still on the report, and the CSV carries every row', () => {
    let s = baseState()
    s = commit(s, saveSalesTarget(s, { staffId: 'u_cash', month: '2026-10', amount: 20000 }, ctx()))
    const rep = commissionReport(s, from, to)
    expect(rep.rows).toEqual([expect.objectContaining({ staffId: 'u_cash', target: 20000, achievementPct: 0, commission: 0 })])
    s = commit(s, saveCommissionRule(s, draft(), undefined, ctx()))
    s = sell(s, 'u_cash', 1).s
    const csv = commissionCsvRows(commissionReport(s, from, to))
    expect(csv[0][0]).toBe('Salesperson')
    expect(csv.some((r) => r[0] === 'Total')).toBe(true)
    expect(csv.some((r) => r[1] === 'Everything')).toBe(true)
  })
})

describe('rules and targets replicate', () => {
  test('the server has what the phone has; only a manager may write them', async () => {
    const r = rig(baseState())
    await r.seed()
    const made = await r.run((s) => saveCommissionRule(s, draft({ slabs: [{ minAchievementPct: 100, rate: 3 }] }), undefined, ctx({ now: NOW + 1 })))
    await r.run((s) => saveSalesTarget(s, { staffId: 'u_cash', month: '2026-10', amount: 40000 }, ctx({ now: NOW + 2 })))
    await r.run((s) => saveSalesTarget(s, { staffId: 'u_cash', month: '2026-10', amount: 45000 }, ctx({ now: NOW + 3 })))
    const gone = await r.run((s) => saveCommissionRule(s, draft({ name: 'Old' }), undefined, ctx({ now: NOW + 4 })))
    await r.run((s) => deleteCommissionRule(s, gone.rule.id, ctx({ now: NOW + 5 })))
    const server = await r.serverView()
    expect(server.commissionRules).toEqual(r.phone.commissionRules)
    expect(server.salesTargets).toEqual(r.phone.salesTargets)
    expect(listOf(server.salesTargets)).toHaveLength(1)
    expect(listOf(server.salesTargets)[0].amount).toBe(45000)
    expect(server.commissionRules[made.rule.id].slabs).toEqual([{ minAchievementPct: 100, rate: 3 }])
    expect(server.commissionRules[gone.rule.id]).toBeUndefined()

    const cashier = actorWith(['pos'], 'u_cash')
    const res = await applyMutations(r.db, [
      { mid: 'c:1', coll: 'commissionRules', id: 'cr_x', op: 'create', data: { ...made.rule, id: 'cr_x' }, at: 1 },
      { mid: 'c:2', coll: 'salesTargets', id: 'st_x', op: 'create', data: { id: 'st_x', staffId: 'u_cash', month: '2026-11', amount: 1 }, at: 1 },
    ], cashier)
    expect(res.map((x) => x.code)).toEqual(['forbidden', 'forbidden'])
  })
})
