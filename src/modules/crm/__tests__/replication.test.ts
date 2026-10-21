import { actorWith, rig } from '@/replication/testkit'
import { applyMutations, MemoryDocStore, mutationsFromChanges } from '@/replication'
import { captureFeedback, addNote, applyReferral, completeTask, convertLead, createCampaign, deleteCampaign, ensureReferralCode, markSend, moveLead, moveTicket, rewardReferral, saveCrmSettings, saveInvoiceLink, saveLead, saveSegment, saveTask, saveTicket, setCustomerTags, markLinkSent } from '../ops'
import { rewardEffects } from '../replication'
import { sendsOf } from '../campaigns'
import { saveBill } from '@/data/ops'
import { billInput, line } from '@/data/__tests__/helpers'
import { ctx, DAY, NOW, sell, shop } from './helpers'

const buy = (r: ReturnType<typeof rig>, customerId: string, at: number) =>
  r.run((s) => saveBill(s, billInput(s, [line(s.variants.v1, 1)], { customerId, date: at }), ctx({ now: at })))

/** A shop already holding bills, as the rig's server will hold them after seeding. */
function world() {
  let s = shop()
  s = sell(s, 'c1', 2, 40).state
  s = sell(s, 'c3', 1, 2).state
  return s
}

describe('crm collections replicate', () => {
  test('every kind of document ends up the same on the server as on the phone', async () => {
    const r = rig(world())
    await r.seed()
    const seg = await r.run((s) => saveSegment(s, { name: 'Lapsed VIPs', match: 'all', rules: [{ kind: 'recency', minDays: 30 }, { kind: 'tag', tag: 'VIP' }], note: '' }, undefined, ctx({ now: NOW + 1 })))
    await r.run((s) => setCustomerTags(s, 'c1', ['VIP', 'Wholesale'], ctx({ now: NOW + 2 })))
    const lead = await r.run((s) => saveLead(s, { name: 'Kavita', phone: '9000000001', source: 'Instagram', value: 5000, nextFollowUp: NOW + DAY }, undefined, ctx({ now: NOW + 3 })))
    await r.run((s) => moveLead(s, lead.lead.id, 'qualified', ctx({ now: NOW + 4 })))
    const conv = await r.run((s) => convertLead(s, lead.lead.id, ctx({ now: NOW + 5 })))
    const task = await r.run((s) => saveTask(s, { title: 'Call Meera', kind: 'call', due: NOW + DAY, customerId: 'c1' }, undefined, ctx({ now: NOW + 6 })))
    await r.run((s) => completeTask(s, task.task.id, true, ctx({ now: NOW + 7 })))
    await r.run((s) => addNote(s, { text: 'Likes silk', customerId: conv.customer.id }, ctx({ now: NOW + 8 })))

    const camp = await r.run((s) => createCampaign(s, { name: 'Diwali', channel: 'whatsapp', template: 'Hi {{firstName}}', audience: 'all' }, ctx({ now: NOW + 9 })))
    const sends = sendsOf(r.phone, camp.campaign.id)
    await r.run((s) => markSend(s, sends[0].id, 'sent', ctx({ now: NOW + 10 })))
    await r.run((s) => markSend(s, sends[1].id, 'skipped', ctx({ now: NOW + 11 })))
    await r.run((s) => markSend(s, sends[1].id, 'pending', ctx({ now: NOW + 12 })))

    const tk = await r.run((s) => saveTicket(s, { kind: 'warranty', subject: 'Zip', customerId: 'c3', billId: Object.values(s.bills).find((b) => b.customerId === 'c3')!.id, priority: 'high' }, ctx({ now: NOW + 13 })))
    await r.run((s) => moveTicket(s, tk.ticket.id, 'resolved', { resolution: 'Replaced', outcome: 'replace' }, ctx({ now: NOW + 14 })))
    await r.run((s) => captureFeedback(s, { rating: 1, nps: 2, comment: 'bad', openTicket: true, customerId: 'c1' }, ctx({ now: NOW + 15 })))
    const bill = Object.values(r.phone.bills)[0]
    await r.run((s) => saveInvoiceLink(s, bill.id, { token: 'tok123', url: 'https://shop.example/p/tok123' }, ctx({ now: NOW + 16 })))
    await r.run((s) => markLinkSent(s, bill.id, ctx({ now: NOW + 17 })))
    await r.run((s) => saveCrmSettings(s, { warrantyMonths: 24, referrerCredit: 120 }, ctx({ now: NOW + 18 })))

    const server = await r.serverView()
    for (const coll of ['crmSegments', 'crmLeads', 'crmTasks', 'crmNotes', 'crmCampaigns', 'crmSends', 'crmTickets', 'crmFeedback', 'invoiceLinks', 'crmSettings', 'customers'] as const) {
      expect(server[coll]).toEqual(r.phone[coll])
      expect(Object.keys(r.phone[coll]).length).toBeGreaterThan(0)
    }
    expect(server.crmSegments[seg.segment.id].rules).toHaveLength(2)
    expect(server.crmSends[sends[1].id].status).toBe('pending')
    expect(server.crmSends[sends[1].id].at).toBeUndefined()
    expect(server.customers.c1.tags).toEqual(['VIP', 'Wholesale'])
    expect(server.crmLeads[lead.lead.id].nextFollowUp).toBeUndefined()

    // removing things replicates too
    await r.run((s) => deleteCampaign(s, camp.campaign.id, ctx({ now: NOW + 19 })))
    await r.run((s) => setCustomerTags(s, 'c1', [], ctx({ now: NOW + 20 })))
    const after = await r.serverView()
    expect(after.crmCampaigns).toEqual({})
    expect(after.crmSends).toEqual({})
    expect(after.customers.c1.tags).toBeUndefined()
    expect(after.customers).toEqual(r.phone.customers)
  })

  test('a referral reward moves store credit and points by the same amounts on the server', async () => {
    const r = rig(world())
    await r.seed()
    await r.run((s) => saveCrmSettings(s, { referrerCredit: 150, referrerPoints: 20, refereeCredit: 50, referralMinBill: 500 }, ctx({ now: NOW + 1 })))
    const code = await r.run((s) => ensureReferralCode(s, 'c1', ctx({ now: NOW + 2 })))
    await r.run((s) => applyReferral(s, 'c2', code.code, ctx({ now: NOW + 3 })))
    await buy(r, 'c2', NOW + 3)
    const before = (await r.serverView()).customers
    await r.run((s) => rewardReferral(s, 'c2', ctx({ now: NOW + 4 })))
    const server = (await r.serverView()).customers
    expect(server.c1.storeCredit).toBe(before.c1.storeCredit + 150)
    expect(server.c1.loyaltyPoints).toBe(before.c1.loyaltyPoints + 20)
    expect(server.c2.storeCredit).toBe(before.c2.storeCredit + 50)
    expect(server).toEqual(r.phone.customers)
    expect((await r.serverView()).referralRewards).toEqual(r.phone.referralRewards)
  })

  test('the same referral cannot be paid twice, even from a phone that has not heard of the first reward', async () => {
    const r = rig(world())
    await r.seed()
    await r.run((s) => saveCrmSettings(s, { referrerCredit: 100, referrerPoints: 0, refereeCredit: 0, referralMinBill: 1 }, ctx({ now: NOW + 1 })))
    const code = await r.run((s) => ensureReferralCode(s, 'c1', ctx({ now: NOW + 2 })))
    await r.run((s) => applyReferral(s, 'c2', code.code, ctx({ now: NOW + 3 })))
    await buy(r, 'c2', NOW + 3)
    const stale = r.phone // another phone with the same view
    const first = rewardReferral(stale, 'c2', ctx({ now: NOW + 4 }))
    const second = rewardReferral(stale, 'c2', ctx({ now: NOW + 5 }))
    let seq = 0
    const muts = (c: typeof first, dev: string) => mutationsFromChanges(stale, c.changes, { deviceId: dev, nextSeq: () => ++seq })
    const res1 = await r.send(muts(first, 'devA'))
    const res2 = await r.send(muts(second, 'devB'))
    expect(res1.every((x) => x.status !== 'rejected')).toBe(true)
    expect(res2.some((x) => x.status === 'duplicate')).toBe(true)
    const server = (await r.serverView()).customers
    expect(server.c1.storeCredit).toBe(100) // once, not twice
  })

  test('who may write what', async () => {
    const db = new MemoryDocStore()
    const cashier = actorWith(['pos', 'customers'])
    const noCustomers = actorWith(['pos'])
    const s = world()
    let seq = 0
    const send = async (changes: Parameters<typeof mutationsFromChanges>[1], as = cashier) => {
      const muts = mutationsFromChanges(s, changes, { deviceId: 'd', nextSeq: () => ++seq })
      return applyMutations(db, muts, as)
    }
    const task = saveTask(s, { title: 't', customerId: 'c1' }, undefined, ctx())
    expect((await send(task.changes)).filter((x) => x.status === 'rejected')).toHaveLength(0)
    expect((await send(task.changes, noCustomers)).some((x) => x.status === 'rejected' && x.code === 'forbidden')).toBe(true)
    const camp = createCampaign(s, { name: 'x', channel: 'sms', template: 'hi', audience: 'all' }, ctx())
    expect((await send(camp.changes)).some((x) => x.status === 'rejected' && x.code === 'forbidden')).toBe(true)
    expect((await send(camp.changes, actorWith(['customers', 'crm']))).filter((x) => x.status === 'rejected')).toHaveLength(0)
    const reward = { id: 'rw_c3', referrerId: 'c1', referredId: 'c3', referrerCredit: 100, referrerPoints: 0, refereeCredit: 0, date: NOW, note: '', userId: 'u', branchId: undefined }
    expect((await send({ put: { referralRewards: [reward] } })).some((x) => x.status === 'rejected' && x.code === 'forbidden')).toBe(true)
    expect((await send({ put: { referralRewards: [{ ...reward, referrerId: 'c3' }] } }, actorWith(['crm']))).some((x) => x.status === 'rejected' && x.code === 'invalid')).toBe(true)
    // a feedback is posted once and never edited
    const fb = captureFeedback(s, { rating: 5 }, ctx())
    await send(fb.changes)
    const edited = [{ mid: 'x:1', coll: 'crmFeedback', id: fb.feedback.id, op: 'patch' as const, data: { comment: 'changed' }, at: 1 }]
    expect((await applyMutations(db, edited, cashier)).some((x) => x.status === 'rejected' && x.code === 'immutable')).toBe(true)
    // nonsense is refused by the rules even if a client skips the operation
    expect((await send({ put: { crmFeedback: [{ id: 'fb_bad', rating: 9, comment: '', at: 1, source: 'counter', userId: 'u' }] } })).some((x) => x.status === 'rejected' && x.code === 'invalid')).toBe(true)
  })

  test('the reward effect adds only what is owed', () => {
    const base = { id: 'rw_x', referrerId: 'a', referredId: 'b', referrerCredit: 0, referrerPoints: 0, refereeCredit: 0, date: 1, note: '', userId: 'u' }
    expect(rewardEffects(base)).toEqual([])
    expect(rewardEffects({ ...base, referrerCredit: 5, refereeCredit: 7 })).toEqual([
      { kind: 'inc', coll: 'customers', id: 'a', field: 'storeCredit', by: 5 },
      { kind: 'inc', coll: 'customers', id: 'b', field: 'storeCredit', by: 7 },
    ])
  })
})
