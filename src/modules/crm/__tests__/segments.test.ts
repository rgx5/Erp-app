import { PRESET_SEGMENTS, dateFalls, describeSegment, matchCtx, matchesRule, resolveAudience, segmentMembers, segmentProblem } from '../segments'
import { membershipOf, ordersIn, spendIn, statsByCustomer, statsOf, tierFor } from '../stats'
import { segmentCsv, segmentFigures } from '../reports'
import { DEFAULT_SETTINGS, settingsOf } from '../settings'
import { deleteSegment, saveSegment, setCustomerTags, setMarketingOptOut } from '../ops'
import { OpError } from '@/data/ops'
import { commit, ctx, DAY, NOW, returnAll, sell, shop } from './helpers'

const names = (s: ReturnType<typeof shop>, id: string) => segmentMembers(s, PRESET_SEGMENTS.find((p) => p.id === id)!, NOW).map((c) => c.name)

describe('customer figures', () => {
  test('spend and orders come from bills; a return takes its value off and is not an order', () => {
    let s = shop()
    s = sell(s, 'c1', 2, 40).state
    const second = sell(s, 'c1', 1, 5)
    s = second.state
    const stats = statsOf(statsByCustomer(s), 'c1')
    expect(stats.orders).toBe(2)
    expect(stats.spend).toBe(1998 + 999)
    s = returnAll(s, second.billId)
    const after = statsOf(statsByCustomer(s), 'c1')
    expect(after.orders).toBe(2)
    expect(after.spend).toBe(1998)
    expect(after.lastAt).toBe(NOW - 5 * DAY)
  })

  test('windows count only what happened inside them', () => {
    let s = shop()
    s = sell(s, 'c1', 1, 200).state
    s = sell(s, 'c1', 2, 10).state
    const st = statsOf(statsByCustomer(s), 'c1')
    expect(spendIn(st, NOW, 30)).toBe(1998)
    expect(spendIn(st, NOW)).toBe(2997)
    expect(ordersIn(st, NOW, 30)).toBe(1)
    expect(ordersIn(st, NOW)).toBe(2)
  })

  test('a customer with no bills has zeros', () => {
    const st = statsOf(statsByCustomer(shop()), 'c3')
    expect(st).toMatchObject({ spend: 0, orders: 0, lastAt: null })
  })
})

describe('rules', () => {
  const world = () => {
    let s = shop()
    s = sell(s, 'c1', 1, 120).state // lapsed
    s = sell(s, 'c2', 6, 3).state // big, recent
    s = sell(s, 'c2', 6, 20).state
    s = sell(s, 'c3', 1, 2).state
    return s
  }

  test('lapsed, high value, frequent, new and never-bought segments', () => {
    const s = world()
    expect(names(s, 'preset:lapsed')).toEqual(['Meera Iyer'])
    expect(names(s, 'preset:high-value')).toEqual(['Arjun Rao'])
    expect(names(s, 'preset:never')).toEqual(['Zed'])
    expect(names(s, 'preset:new').sort()).toEqual(['Priya Shah', 'Zed'])
    expect(names(s, 'preset:frequent')).toEqual([])
  })

  test('birthday and anniversary periods ignore the year', () => {
    const s = world()
    expect(names(s, 'preset:birthday-month')).toEqual(['Meera Iyer']) // 25 Oct
    expect(names(s, 'preset:birthday-week')).toEqual(['Meera Iyer']) // 6 days away
    expect(names(s, 'preset:anniversary-month')).toEqual(['Arjun Rao']) // 19 Oct
    expect(dateFalls('2000-10-19', 'today', NOW)).toBe(true)
    expect(dateFalls('2000-10-25', 'week', NOW)).toBe(true) // 6 days away
    expect(dateFalls('2000-10-26', 'week', NOW)).toBe(false)
    expect(dateFalls('2000-11-02', 'next-month', NOW)).toBe(true)
    expect(dateFalls('', 'month', NOW)).toBe(false)
  })

  test('groups match case-insensitively, and can be negated', () => {
    const s = world()
    const m = matchCtx(s, NOW)
    expect(matchesRule(s.customers.c2, { kind: 'tag', tag: 'vip' }, m)).toBe(true)
    expect(matchesRule(s.customers.c1, { kind: 'tag', tag: 'vip' }, m)).toBe(false)
    expect(matchesRule(s.customers.c1, { kind: 'tag', tag: 'vip', not: true }, m)).toBe(true)
  })

  test('all vs any, and an empty segment is everyone', () => {
    const s = world()
    const all = segmentMembers(s, { match: 'all', rules: [{ kind: 'spend', min: 900 }, { kind: 'tag', tag: 'VIP' }] }, NOW).map((c) => c.id)
    expect(all).toEqual(['c2'])
    const any = segmentMembers(s, { match: 'any', rules: [{ kind: 'spend', min: 1500 }, { kind: 'never' }] }, NOW).map((c) => c.id).sort()
    expect(any).toEqual(['c2', 'c4'])
    expect(segmentMembers(s, { match: 'all', rules: [] }, NOW)).toHaveLength(4)
  })

  test('members come biggest spender first', () => {
    const s = world()
    expect(segmentMembers(s, { match: 'all', rules: [] }, NOW).map((c) => c.id).slice(0, 2)).toEqual(['c2', 'c1'])
  })

  test('recency needs a purchase; orders and spend honour their window', () => {
    const s = world()
    const m = matchCtx(s, NOW)
    expect(matchesRule(s.customers.c4, { kind: 'recency', minDays: 1 }, m)).toBe(false)
    expect(matchesRule(s.customers.c2, { kind: 'orders', min: 2, days: 30 }, m)).toBe(true)
    expect(matchesRule(s.customers.c2, { kind: 'orders', min: 2, days: 10 }, m)).toBe(false)
    expect(matchesRule(s.customers.c3, { kind: 'spend', max: 1000 }, m)).toBe(true)
  })

  test('membership tiers are by spend in the window', () => {
    let s = world()
    const cfg = settingsOf(s)
    expect(tierFor(0, cfg.tiers)?.name).toBe('Member')
    expect(tierFor(10_000, cfg.tiers)?.name).toBe('Silver')
    expect(tierFor(99_999, cfg.tiers)?.name).toBe('Gold')
    const mem = membershipOf(statsOf(statsByCustomer(s), 'c2'), NOW, cfg)
    expect(mem).toMatchObject({ spend: 11_988, toNext: 38_012 })
    expect(mem.tier?.name).toBe('Silver')
    expect(mem.next?.name).toBe('Gold')
    expect(segmentMembers(s, { match: 'all', rules: [{ kind: 'tier', tier: 'silver' }] }, NOW).map((c) => c.id)).toEqual(['c2'])
    s = shop()
    expect(settingsOf(s)).toBe(DEFAULT_SETTINGS)
  })
})

describe('segment ops', () => {
  test('save, refuse bad rules and duplicate names, delete', () => {
    let s = shop()
    const a = saveSegment(s, { name: ' Big spenders ', match: 'all', rules: [{ kind: 'spend', min: 5000 }] }, undefined, ctx())
    s = commit(s, a)
    expect(a.segment.name).toBe('Big spenders')
    expect(() => saveSegment(s, { name: 'big spenders', match: 'all', rules: [{ kind: 'never' }] }, undefined, ctx())).toThrow('already have')
    expect(() => saveSegment(s, { name: '', match: 'all', rules: [{ kind: 'never' }] }, undefined, ctx())).toThrow('name')
    expect(() => saveSegment(s, { name: 'x', match: 'all', rules: [] }, undefined, ctx())).toThrow('at least one rule')
    expect(() => saveSegment(s, { name: 'x', match: 'all', rules: [{ kind: 'spend', min: 9, max: 1 }] }, undefined, ctx())).toThrow(OpError)
    const edit = saveSegment(s, { name: 'Big spenders', match: 'any', rules: [{ kind: 'never' }] }, a.segment.id, ctx({ now: NOW + 5 }))
    expect(edit.segment.createdAt).toBe(NOW)
    expect(edit.segment.updatedAt).toBe(NOW + 5)
    s = commit(s, deleteSegment(s, a.segment.id, ctx()))
    expect(s.crmSegments[a.segment.id]).toBeUndefined()
    expect(resolveAudience(s, a.segment.id)).toBeNull()
    expect(resolveAudience(s, 'preset:lapsed')?.name).toBe('Lapsed customers')
    expect(resolveAudience(s, 'all')?.def.rules).toEqual([])
  })

  test('groups are tidied and can be cleared', () => {
    let s = shop()
    const r = setCustomerTags(s, 'c1', [' VIP ', 'vip', 'Wholesale', ''], ctx())
    expect(r.customer.tags).toEqual(['VIP', 'Wholesale'])
    s = commit(s, r)
    expect(setCustomerTags(s, 'c1', [], ctx()).customer.tags).toBeUndefined()
    expect(() => setCustomerTags(s, 'c1', ['x'.repeat(25)], ctx())).toThrow('24')
    expect(() => setCustomerTags(s, 'nope', ['a'], ctx())).toThrow('no longer exists')
  })

  test('opting out sets and clears the flag', () => {
    let s = shop()
    s = commit(s, setMarketingOptOut(s, 'c1', true, ctx()))
    expect(s.customers.c1.optOutMarketing).toBe(true)
    s = commit(s, setMarketingOptOut(s, 'c1', false, ctx()))
    expect(s.customers.c1.optOutMarketing).toBeUndefined()
  })
})

describe('words and export', () => {
  test('rules are described in plain words', () => {
    expect(describeSegment({ match: 'all', rules: [{ kind: 'recency', minDays: 90 }, { kind: 'spend', min: 5000, days: 365 }] })).toBe('Not bought for 90 days or more and Spent ₹5,000 or more in the last 365 days')
    expect(describeSegment({ match: 'any', rules: [] })).toBe('Everyone')
    expect(segmentProblem('a', [{ kind: 'tag', tag: ' ' }])).toMatch('group')
  })

  test('the csv lists the members with their figures, safely', () => {
    let s = shop()
    s = sell(s, 'c2', 1, 3).state
    const members = segmentMembers(s, { match: 'all', rules: [] }, NOW)
    const csv = segmentCsv(members, statsByCustomer(s), NOW)
    expect(csv.split('\r\n')[0]).toBe('Name,Phone,Email,Birthday,Groups,Points,Store credit,Orders,Spent,Last purchase')
    expect(csv).toContain('Arjun Rao,9876500002')
    expect(segmentFigures(members, s, NOW)).toEqual({ count: 4, spend: 999, reachable: 3 })
  })
})
