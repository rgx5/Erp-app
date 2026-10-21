import { OpError, saveBill } from '@/data/ops'
import { billInput, line } from '@/data/__tests__/helpers'
import { buildAudience, campaignProgress, dialNumber, fieldsFor, linkFor, MERGE_FIELDS, nextPending, renderTemplate, sendsOf, TEMPLATES, unknownFields, whatsappLink } from '../campaigns'
import { awaitingFeedback, feedbackRequest, isLowScore, npsClass, npsSummary } from '../feedback'
import { applyReferral, captureFeedback, createCampaign, deleteCampaign, ensureReferralCode, markSend, moveTicket, rewardReferral, saveCrmSettings, saveTicket, setMarketingOptOut, setTicketPriority, assignTicket } from '../ops'
import { customerByCode, makeReferralCode, referralRows, rewardIdFor, topReferrers } from '../referrals'
import { crmAlerts } from '../reports'
import { settingsOf } from '../settings'
import { canMove, nextStatuses, slaDueFor, slaLabel, slaState, ticketQueue, ticketSummary, warrantyCover, warrantyEnds } from '../tickets'
import { commit, ctx, DAY, NOW, sell, shop } from './helpers'

describe('campaign messages', () => {
  test('numbers are made WhatsApp-ready; rubbish gives no link', () => {
    expect(dialNumber('98765 43210')).toBe('919876543210')
    expect(dialNumber('09876543210')).toBe('919876543210')
    expect(dialNumber('+91 98765-43210')).toBe('919876543210')
    expect(dialNumber('12345')).toBeNull()
    expect(dialNumber('')).toBeNull()
    expect(whatsappLink('9876543210', 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye')
    expect(linkFor('sms', '9876543210', 'Hi')).toBe('sms:+919876543210?body=Hi')
    expect(linkFor('sms', null, 'Hi')).toBeNull()
  })

  test('merge fields fill in; an unknown one stays visible and is reported', () => {
    expect(renderTemplate('Hi {{firstName}} at {{ shop }}, {{oops}}', { firstName: 'Meera', shop: 'Kosh' })).toBe('Hi Meera at Kosh, {{oops}}')
    expect(unknownFields('{{name}} {{ nope }} {{nope}}')).toEqual(['nope'])
    for (const t of TEMPLATES) expect(unknownFields(t.text)).toEqual([])
    expect(MERGE_FIELDS.map((f) => f.key)).toContain('lastVisit')
  })

  test('fields come from the customer and their bills', () => {
    const s = sell(shop(), 'c1', 1, 10).state
    const f = fieldsFor(s, s.customers.c1, NOW)
    expect(f).toMatchObject({ name: 'Meera Iyer', firstName: 'Meera', shop: 'Test Store', points: '50', credit: '₹0', spend: '₹999' })
    expect(f.lastVisit).toMatch('2026')
    expect(fieldsFor(s, s.customers.c3, NOW).lastVisit).toBe('your first visit')
  })

  test('the audience leaves out people with no number and those who opted out', () => {
    let s = shop()
    s = commit(s, setMarketingOptOut(s, 'c3', true, ctx()))
    const a = buildAudience(s, 'all', 'Hello {{firstName}}', 'whatsapp', NOW)!
    expect(a.recipients.map((r) => r.customer.id).sort()).toEqual(['c1', 'c2'])
    expect(a.noPhone.map((c) => c.id)).toEqual(['c4'])
    expect(a.optedOut.map((c) => c.id)).toEqual(['c3'])
    expect(a.recipients[0].text).toMatch(/^Hello (Meera|Arjun)$/)
    expect(a.recipients[0].link).toContain('wa.me/91')
    expect(buildAudience(s, 'gone', 'x', 'sms', NOW)).toBeNull()
  })
})

describe('campaign ops', () => {
  const draft = (over: Record<string, unknown> = {}) => ({ name: 'Diwali', channel: 'whatsapp' as const, template: 'Hi {{firstName}}, happy Diwali from {{shop}}', audience: 'all', ...over })

  test('building a campaign makes one message per reachable customer, numbered', () => {
    let s = shop()
    const r = createCampaign(s, draft(), ctx())
    expect(r.campaign).toMatchObject({ no: 'CP-0001', count: 3, audienceName: 'All customers' })
    expect(r.skipped).toEqual({ noPhone: 1, optedOut: 0 })
    expect(r.sends.map((x) => x.text).sort()).toEqual(['Hi Arjun, happy Diwali from Test Store', 'Hi Meera, happy Diwali from Test Store', 'Hi Priya, happy Diwali from Test Store'])
    expect(r.sends.every((x) => x.status === 'pending')).toBe(true)
    s = commit(s, r)
    expect(createCampaign(s, draft(), ctx({ series: 'M4X' })).campaign.no).toBe('CP-M4X-0001')
    expect(createCampaign(s, draft(), ctx()).campaign.no).toBe('CP-0002')
  })

  test('refusals', () => {
    const s = shop()
    expect(() => createCampaign(s, draft({ name: '' }), ctx())).toThrow('name')
    expect(() => createCampaign(s, draft({ template: ' ' }), ctx())).toThrow('message')
    expect(() => createCampaign(s, draft({ template: 'Hi {{nickname}}' }), ctx())).toThrow('nickname')
    expect(() => createCampaign(s, draft({ audience: 'seg_x' }), ctx())).toThrow('no longer')
    expect(() => createCampaign(s, draft({ audience: 'preset:dues' }), ctx())).toThrow('No one')
    expect(() => createCampaign(s, draft({ channel: 'pigeon' as never }), ctx())).toThrow(OpError)
  })

  test('working through the list: sent and skipped are tracked, a log is written, the campaign closes at the end', () => {
    let s = shop()
    const made = createCampaign(s, draft({ audience: 'preset:birthday-month' }), ctx())
    s = commit(s, createCampaign(s, draft(), ctx()))
    const camp = Object.values(s.crmCampaigns)[0]
    let sends = sendsOf(s, camp.id)
    expect(made.sends).toHaveLength(1)
    expect(sends).toHaveLength(3)
    expect(campaignProgress(sends)).toMatchObject({ total: 3, sent: 0, pending: 3, done: false, pct: 0 })
    expect(nextPending(sends)?.id).toBe(sends[0].id)

    s = commit(s, markSend(s, sends[0].id, 'sent', ctx({ now: NOW + 1 })))
    s = commit(s, markSend(s, sends[1].id, 'skipped', ctx({ now: NOW + 2 })))
    sends = sendsOf(s, camp.id)
    expect(campaignProgress(sends)).toMatchObject({ sent: 1, skipped: 1, pending: 1, pct: 67 })
    expect(s.crmCampaigns[camp.id].closedAt).toBeUndefined()
    expect(s.crmSends[sends[0].id]).toMatchObject({ status: 'sent', at: NOW + 1, userId: 'u_owner' })
    expect(s.crmNotes[`nt_${sends[0].id}`]).toMatchObject({ kind: 'whatsapp', customerId: sends[0].customerId })
    expect(s.crmNotes[`nt_${sends[1].id}`]).toBeUndefined()

    s = commit(s, markSend(s, sends[2].id, 'sent', ctx({ now: NOW + 3 })))
    expect(s.crmCampaigns[camp.id].closedAt).toBe(NOW + 3)
    // undoing one reopens the campaign and takes its log entry away
    s = commit(s, markSend(s, sends[2].id, 'pending', ctx({ now: NOW + 4 })))
    expect(s.crmCampaigns[camp.id].closedAt).toBeUndefined()
    expect(s.crmNotes[`nt_${sends[2].id}`]).toBeUndefined()
    expect(s.crmSends[sends[2].id].at).toBeUndefined()
    expect(() => markSend(s, 'nope', 'sent', ctx())).toThrow('no longer')

    s = commit(s, deleteCampaign(s, camp.id, ctx()))
    expect(Object.keys(s.crmSends)).toHaveLength(0)
    expect(Object.keys(s.crmCampaigns)).toHaveLength(0)
  })
})

describe('tickets', () => {
  const cfg = settingsOf(shop())

  test('the due time follows the priority; the state follows the clock', () => {
    expect(slaDueFor('high', NOW, cfg)).toBe(NOW + 24 * 3_600_000)
    expect(slaDueFor('low', NOW, cfg)).toBe(NOW + 168 * 3_600_000)
    const t = { status: 'open' as const, openedAt: NOW, slaDue: NOW + 24 * 3_600_000 }
    expect(slaState(t, NOW + 3_600_000)).toBe('ok')
    expect(slaState(t, NOW + 21 * 3_600_000)).toBe('due-soon')
    expect(slaState(t, NOW + 25 * 3_600_000)).toBe('breached')
    expect(slaLabel(t, NOW + 25 * 3_600_000)).toBe('1 h late')
    expect(slaLabel(t, NOW + 21 * 3_600_000)).toBe('3 h left')
    expect(slaState({ ...t, status: 'resolved', resolvedAt: NOW + 3_600_000 }, NOW + 99 * DAY)).toBe('met')
    expect(slaState({ ...t, status: 'closed', resolvedAt: NOW + 30 * 3_600_000 }, NOW + 99 * DAY)).toBe('missed')
  })

  test('the status flow', () => {
    expect(nextStatuses('open')).toEqual(['in-progress', 'waiting', 'resolved'])
    expect(canMove('open', 'closed')).toBe(false)
    expect(canMove('resolved', 'open')).toBe(true)
    expect(canMove('closed', 'resolved')).toBe(false)
  })

  test('warranty runs from the sale for the months in the settings', () => {
    const sale = new Date('2026-01-31T10:00:00').getTime()
    expect(new Date(warrantyEnds(sale, 12)).getFullYear()).toBe(2027)
    expect(warrantyCover(sale, 12, NOW).covered).toBe(true)
    expect(warrantyCover(sale, 6, NOW).covered).toBe(false)
  })

  test('opening a ticket takes the customer’s details and sets the SLA', () => {
    const s = shop()
    const r = saveTicket(s, { kind: 'complaint', subject: 'Colour ran in wash', customerId: 'c1', priority: 'high' }, ctx())
    expect(r.ticket).toMatchObject({ no: 'TK-0001', status: 'open', partyName: 'Meera Iyer', partyPhone: '9876543210', slaDue: NOW + 24 * 3_600_000, customerId: 'c1' })
    expect(() => saveTicket(s, { kind: 'complaint', subject: '' }, ctx())).toThrow('problem')
    expect(() => saveTicket(s, { kind: 'complaint', subject: 'x' }, ctx())).toThrow('customer')
    expect(saveTicket(s, { kind: 'complaint', subject: 'x', partyName: 'Walk-in' }, ctx()).ticket.partyName).toBe('Walk-in')
    expect(() => saveTicket(s, { kind: 'warranty', subject: 'x', customerId: 'c1' }, ctx())).toThrow('warranty')
    expect(() => saveTicket(s, { kind: 'service', subject: 'x', customerId: 'c1', billId: 'nope' }, ctx())).toThrow('bill')
  })

  test('a warranty claim names the bill and says when the bill is outside warranty', () => {
    let s = shop()
    const old = sell(s, 'c1', 1, 500)
    s = old.state
    const r = saveTicket(s, { kind: 'warranty', subject: 'Zip broke', customerId: 'c1', billId: old.billId, serial: 'SN1' }, ctx())
    expect(r.ticket).toMatchObject({ billId: old.billId, serial: 'SN1' })
    expect(r.changes.put?.crmNotes?.[0].text).toMatch('outside the 12-month warranty')
    const fresh = sell(s, 'c1', 1, 20)
    expect(saveTicket(fresh.state, { kind: 'warranty', subject: 'Zip', customerId: 'c1', billId: fresh.billId }, ctx()).changes.put?.crmNotes).toBeUndefined()
    // another customer's bill is refused
    expect(() => saveTicket(s, { kind: 'warranty', subject: 'x', customerId: 'c2', billId: old.billId }, ctx())).toThrow('another customer')
  })

  test('moving a ticket: resolving needs words (and an outcome for warranty), closing, reopening restarts the clock', () => {
    let s = shop()
    const w = sell(s, 'c1', 1, 20)
    s = w.state
    const t = saveTicket(s, { kind: 'warranty', subject: 'Zip', customerId: 'c1', billId: w.billId }, ctx())
    s = commit(s, t)
    const id = t.ticket.id
    expect(() => moveTicket(s, id, 'closed', {}, ctx())).toThrow('cannot go')
    s = commit(s, moveTicket(s, id, 'in-progress', { note: 'sent to the brand' }, ctx({ now: NOW + 1 })))
    s = commit(s, moveTicket(s, id, 'waiting', {}, ctx({ now: NOW + 2 })))
    expect(() => moveTicket(s, id, 'resolved', {}, ctx())).toThrow('how it was resolved')
    expect(() => moveTicket(s, id, 'resolved', { resolution: 'New zip fitted' }, ctx())).toThrow('outcome')
    s = commit(s, moveTicket(s, id, 'resolved', { resolution: 'New zip fitted', outcome: 'repair' }, ctx({ now: NOW + 3_600_000 })))
    expect(s.crmTickets[id]).toMatchObject({ status: 'resolved', resolution: 'New zip fitted', outcome: 'repair', resolvedAt: NOW + 3_600_000 })
    expect(slaState(s.crmTickets[id], NOW + DAY * 30)).toBe('met')
    s = commit(s, moveTicket(s, id, 'closed', {}, ctx({ now: NOW + 2 * 3_600_000 })))
    expect(s.crmTickets[id].closedAt).toBe(NOW + 2 * 3_600_000)
    s = commit(s, moveTicket(s, id, 'open', { note: 'zip broke again' }, ctx({ now: NOW + 10 * DAY })))
    expect(s.crmTickets[id]).toMatchObject({ status: 'open', slaDue: NOW + 10 * DAY + 72 * 3_600_000 })
    expect(s.crmTickets[id].resolvedAt).toBeUndefined()
    expect(s.crmTickets[id].outcome).toBeUndefined()
    const log = Object.values(s.crmNotes).filter((n) => n.ticketId === id).sort((a, b) => a.at - b.at).map((n) => n.text)
    expect(log).toEqual(['In progress: sent to the brand', 'Waiting on customer', 'Resolved: New zip fitted', 'Closed', 'Open: zip broke again'])
  })

  test('priority recomputes the due time; assigning needs a real person', () => {
    let s = shop()
    const t = saveTicket(s, { kind: 'complaint', subject: 'x', customerId: 'c1' }, ctx())
    s = commit(s, t)
    s = commit(s, setTicketPriority(s, t.ticket.id, 'high', ctx()))
    expect(s.crmTickets[t.ticket.id].slaDue).toBe(NOW + 24 * 3_600_000)
    s = commit(s, assignTicket(s, t.ticket.id, 'u_cash', ctx()))
    expect(s.crmTickets[t.ticket.id].assignedTo).toBe('u_cash')
    expect(() => assignTicket(s, t.ticket.id, 'ghost', ctx())).toThrow('team')
    s = commit(s, assignTicket(s, t.ticket.id, null, ctx()))
    expect(s.crmTickets[t.ticket.id].assignedTo).toBeUndefined()
  })

  test('summary and queue', () => {
    let s = shop()
    const mk = (subject: string, priority: 'low' | 'high', at: number) => { const r = saveTicket(s, { kind: 'complaint', subject, customerId: 'c1', priority }, ctx({ now: at })); s = commit(s, r); return r.ticket }
    const a = mk('a', 'high', NOW - 3 * DAY) // breached
    mk('b', 'low', NOW) // ok
    const c = mk('c', 'high', NOW - 3_600_000 * 2) // due soon
    s = commit(s, moveTicket(s, c.id, 'resolved', { resolution: 'fixed' }, ctx({ now: NOW })))
    const sum = ticketSummary(s, NOW)
    expect(sum).toMatchObject({ open: 2, breached: 1, dueSoon: 0, resolved: 1, avgResolutionHours: 2, slaMetPct: 100 })
    expect(sum.byKind.complaint).toBe(2)
    expect(ticketQueue(s).map((t) => t.id)[0]).toBe(a.id)
  })
})

describe('feedback', () => {
  test('classes and summary', () => {
    expect([10, 9, 8, 7, 6, 0].map(npsClass)).toEqual(['promoter', 'promoter', 'passive', 'passive', 'detractor', 'detractor'])
    const list = [{ nps: 10, rating: 5 }, { nps: 9 }, { nps: 7 }, { nps: 3, rating: 1 }].map((x, i) => ({ id: String(i), comment: '', at: i, source: 'counter' as const, userId: 'u', ...x }))
    expect(npsSummary(list)).toMatchObject({ scored: 4, promoters: 2, passives: 1, detractors: 1, score: 25, avgRating: 3, rated: 2 })
    expect(npsSummary([]).score).toBeNull()
    expect(isLowScore({ rating: 2 })).toBe(true)
    expect(isLowScore({ rating: 3, nps: 7 })).toBe(false)
    expect(isLowScore({ nps: 6 })).toBe(true)
  })

  test('capturing: needs a score in range, once per bill, takes the customer from the bill', () => {
    let s = shop()
    const w = sell(s, 'c1', 1, 3)
    s = w.state
    expect(() => captureFeedback(s, {}, ctx())).toThrow('rating')
    expect(() => captureFeedback(s, { rating: 6 }, ctx())).toThrow('1 to 5')
    expect(() => captureFeedback(s, { nps: 11 }, ctx())).toThrow('0 to 10')
    expect(() => captureFeedback(s, { rating: 4, billId: 'nope' }, ctx())).toThrow('bill')
    const r = captureFeedback(s, { rating: 5, nps: 10, billId: w.billId, comment: ' lovely ' }, ctx())
    expect(r.feedback).toMatchObject({ customerId: 'c1', billId: w.billId, rating: 5, nps: 10, comment: 'lovely', source: 'counter' })
    s = commit(s, r)
    expect(() => captureFeedback(s, { rating: 4, billId: w.billId }, ctx())).toThrow('already')
  })

  test('a low score can open a complaint, linked both ways', () => {
    let s = shop()
    const w = sell(s, 'c1', 1, 3)
    s = w.state
    const r = captureFeedback(s, { rating: 1, billId: w.billId, comment: 'torn', openTicket: true }, ctx())
    expect(r.ticket).toMatchObject({ kind: 'complaint', priority: 'high', customerId: 'c1', billId: w.billId })
    expect(r.feedback.ticketId).toBe(r.ticket?.id)
    s = commit(s, r)
    expect(Object.keys(s.crmTickets)).toHaveLength(1)
    const happy = sell(s, 'c2', 1, 3)
    expect(captureFeedback(happy.state, { rating: 5, billId: happy.billId, openTicket: true }, ctx()).ticket).toBeUndefined()
  })

  test('recent sales nobody asked about, and the words to ask', () => {
    let s = shop()
    const a = sell(s, 'c1', 1, 3)
    s = a.state
    s = sell(s, 'c2', 1, 30).state // too old
    s = sell(s, 'c3', 1, 0).state // too fresh
    const walkIn = saveBill(s, billInput(s, [line(s.variants.v2, 1)], { customerId: null, date: NOW - 2 * DAY }), ctx({ now: NOW - 2 * DAY }))
    s = commit(s, walkIn)
    expect(awaitingFeedback(s, NOW).map((b) => b.id)).toEqual([a.billId])
    s = commit(s, captureFeedback(s, { rating: 4, billId: a.billId }, ctx()))
    expect(awaitingFeedback(s, NOW)).toEqual([])
    expect(feedbackRequest('Kosh', 'Dr. Meera Iyer', 'INV-1')).toMatch('Hello Meera, thank you for shopping with Kosh (bill INV-1)')
  })
})

describe('referrals and membership', () => {
  test('codes are three letters of the name plus three characters, and never repeat', () => {
    let n = 0
    const rnd = () => ((n++ % 2) === 0 ? 0 : 0.5)
    const taken = new Set(['MEEAAA'])
    const code = makeReferralCode('Meera Iyer', taken, rnd)
    expect(code).toMatch(/^MEE[A-Z2-9]{3}$/)
    expect(code).not.toBe('MEEAAA')
    expect(makeReferralCode('Al', new Set(), () => 0)).toBe('ALXAAA')
  })

  test('a customer keeps the code they were given; codes are looked up loosely', () => {
    let s = shop()
    const a = ensureReferralCode(s, 'c1', ctx(), () => 0.3)
    s = commit(s, a)
    expect(ensureReferralCode(s, 'c1', ctx()).changes).toEqual({})
    expect(ensureReferralCode(s, 'c1', ctx()).code).toBe(a.code)
    expect(customerByCode(s, ` ${a.code.toLowerCase().slice(0, 3)}-${a.code.slice(3)} `)?.id).toBe('c1')
    expect(customerByCode(s, 'ZZZZZZ')).toBeNull()
    expect(customerByCode(s, '')).toBeNull()
  })

  test('applying a code: only for someone who has not bought, once, not their own', () => {
    let s = shop()
    const code = ensureReferralCode(s, 'c1', ctx())
    s = commit(s, code)
    expect(() => applyReferral(s, 'c3', 'NOPE', ctx())).toThrow('does not match')
    expect(() => applyReferral(s, 'c1', code.code, ctx())).toThrow('themselves')
    const ok = applyReferral(s, 'c3', code.code, ctx())
    expect(ok.customer.referredBy).toBe('c1')
    s = commit(s, ok)
    expect(() => applyReferral(s, 'c3', code.code, ctx())).toThrow('already')
    const bought = sell(s, 'c2', 1, 1)
    expect(() => applyReferral(bought.state, 'c2', code.code, ctx())).toThrow('not bought yet')
  })

  test('the reward is due after a big enough purchase, is given once, and moves store credit and points', () => {
    let s = shop()
    const code = ensureReferralCode(s, 'c1', ctx())
    s = commit(s, code)
    s = commit(s, applyReferral(s, 'c3', code.code, ctx()))
    expect(referralRows(s)[0]).toMatchObject({ rewarded: false, ready: false, spend: 0 })
    expect(() => rewardReferral(s, 'c3', ctx())).toThrow('must buy for at least')
    s = sell(s, 'c3', 1, 1).state
    expect(referralRows(s)[0]).toMatchObject({ ready: true, spend: 999 })
    s = commit(s, saveCrmSettings(s, { referrerCredit: 150, referrerPoints: 20, refereeCredit: 50 }, ctx()))
    const r = rewardReferral(s, 'c3', ctx({ now: NOW + 5 }))
    expect(r.reward).toMatchObject({ id: rewardIdFor('c3'), referrerId: 'c1', referredId: 'c3', referrerCredit: 150, referrerPoints: 20, refereeCredit: 50 })
    s = commit(s, r)
    expect(s.customers.c1).toMatchObject({ storeCredit: 150, loyaltyPoints: 70 })
    expect(s.customers.c3.storeCredit).toBe(50)
    expect(referralRows(s)[0]).toMatchObject({ rewarded: true, ready: false })
    expect(() => rewardReferral(s, 'c3', ctx())).toThrow('already')
    expect(() => rewardReferral(s, 'c1', ctx())).toThrow('not referred')
    expect(topReferrers(referralRows(s))).toEqual([expect.objectContaining({ count: 1, rewarded: 1 })])
  })
})

describe('settings and alerts', () => {
  test('settings are checked and tiers kept in order', () => {
    const s = shop()
    const r = saveCrmSettings(s, { tiers: [{ name: 'Gold', minSpend: 5000, perk: ' x ' }, { name: 'Basic', minSpend: 0, perk: '' }], warrantyMonths: 24 }, ctx())
    expect(r.settings.tiers.map((t) => t.name)).toEqual(['Basic', 'Gold'])
    expect(r.settings.tiers[1].perk).toBe('x')
    expect(settingsOf(commit(s, r)).warrantyMonths).toBe(24)
    expect(() => saveCrmSettings(s, { slaHours: { high: 0, normal: 1, low: 1 } }, ctx())).toThrow('Hours')
    expect(() => saveCrmSettings(s, { warrantyMonths: 1.5 }, ctx())).toThrow('Warranty')
    expect(() => saveCrmSettings(s, { tiers: [{ name: 'A', minSpend: 0, perk: '' }, { name: 'a', minSpend: 5, perk: '' }] }, ctx())).toThrow('Two tiers')
    expect(() => saveCrmSettings(s, { referrerCredit: -1 }, ctx())).toThrow('negative')
  })

  test('alerts count what needs a look today', () => {
    let s = shop()
    expect(crmAlerts(s, NOW)).toEqual({ tasksOverdue: 0, tasksToday: 0, leadsDue: 0, ticketsBreached: 0, ticketsDueSoon: 0, referralsReady: 0, birthdaysToday: 0 })
    s = { ...s, customers: { ...s.customers, c1: { ...s.customers.c1, dob: '1990-10-19' } } }
    s = commit(s, saveTicket(s, { kind: 'complaint', subject: 'x', customerId: 'c1', priority: 'high' }, ctx({ now: NOW - 3 * DAY })))
    expect(crmAlerts(s, NOW)).toMatchObject({ ticketsBreached: 1, birthdaysToday: 1 })
  })
})
