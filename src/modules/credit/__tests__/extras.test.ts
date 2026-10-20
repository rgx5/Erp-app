import { baseState, billInput, ctx, line, NOW } from '@/data/__tests__/helpers'
import type { Payment } from '@/domain/types'
import { saveBill } from '@/data/ops'
import { applyChanges, type DataState } from '@/data/state'
import { rig } from '@/replication/testkit'
import { isBalanced, postingsFor } from '@/modules/postings'
import '../../accounting/postings'
import { registerBillHook } from '../../registry'
import { findGiftCard, giftCardBalance, giftCodeOf } from '../giftcards'
import { creditBillHook, receiptLines } from '../hooks'
import { creditStatus, DAY, netDue, receivables } from '../logic'
import { overdueNow } from '../notices'
import { issueGiftCard, recordCollection, refundToGiftCard, rechargeGiftCard, saveCreditSettings, saveCustomerTerms, topUpStoreCredit } from '../ops'
import { collectionPosting, giftCardTxnPosting, topupPosting } from '../postings'
import { encodeQr, qrPath } from '../qr'
import { buildReminder, dueRequest, paymentRequest, reminderQueue, smsUrl, whatsappNumber, whatsappUrl } from '../reminders'
import { agingCsv, receivablesSummary, recentStatement, statementCsv, statementText } from '../reports'
import { isUpiId, upiLink } from '../upi'

registerBillHook(creditBillHook)
const apply = (s: DataState, c: { changes: Parameters<typeof applyChanges>[1] }) => applyChanges(s, c.changes)

function dueSale(s: DataState, at = NOW, over: { paidNow?: number; ext?: Record<string, unknown> } = {}) {
  const b = billInput(s, [line(s.variants.v1, 2)], { customerId: 'c1' })
  const paidNow = over.paidNow ?? 0
  const payments = [...(paidNow ? [{ mode: 'cash' as const, amount: paidNow }] : []), { mode: 'due' as const, amount: Math.round((b.total - paidNow) * 100) / 100 }]
  return saveBill(s, { ...b, payments, paid: paidNow, date: at, ...(over.ext ? { ext: over.ext } : {}) }, ctx({ now: at }))
}
const withSettings = (s: DataState) => apply(s, saveCreditSettings(s, { upiId: 'asha@okbank', payeeName: 'Asha Stores', reminderTone: 'polite' }, ctx()))

describe('UPI link and QR code', () => {
  test('the link carries the payee, the amount with two decimals, and encoded text', () => {
    expect(upiLink({ vpa: ' asha@okbank ', name: 'Asha Stores', amount: 1250.5, note: 'Bill INV-0042', ref: 'INV-0042' }))
      .toBe('upi://pay?pa=asha%40okbank&pn=Asha%20Stores&am=1250.50&cu=INR&tn=Bill%20INV-0042&tr=INV-0042')
    expect(upiLink({ vpa: 'a@b', name: '' })).toBe('upi://pay?pa=a%40b&pn=a%40b&cu=INR')
    expect(upiLink({ vpa: 'a@b', name: 'A', amount: 0 })).not.toContain('am=')
    expect(isUpiId('asha@okbank')).toBe(true)
    expect(isUpiId('asha okbank')).toBe(false)
  })

  test('the QR matrix is square with the three finder patterns, and its path draws exactly the dark modules', () => {
    const link = upiLink({ vpa: 'asha@okbank', name: 'Asha Stores', amount: 999, note: 'Dues', ref: 'X1' })
    const m = encodeQr(link, 'M')
    const n = m.length
    expect(m.every((row) => row.length === n)).toBe(true)
    expect((n - 17) % 4).toBe(0) // 17 + 4 × version
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
        const ring = i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)
        expect(m[r + i][c + j]).toBe(ring)
      }
    }
    const dark = m.flat().filter(Boolean).length
    const drawn = [...qrPath(m).matchAll(/h(\d+)v1/g)].reduce((s, x) => s + Number(x[1]), 0)
    expect(drawn).toBe(dark)
    expect(encodeQr(link, 'M')).toEqual(m) // deterministic
    expect(() => encodeQr('')).toThrow()
  })
})

describe('reminders and payment requests', () => {
  test('phone numbers become WhatsApp numbers; unusable ones give no link', () => {
    expect(whatsappNumber('98765 43210')).toBe('919876543210')
    expect(whatsappNumber('09876543210')).toBe('919876543210')
    expect(whatsappNumber('+91 98765-43210')).toBe('919876543210')
    expect(whatsappNumber('12345')).toBeNull()
    expect(whatsappNumber('')).toBeNull()
    expect(whatsappUrl('9876543210', 'hi there')).toBe('https://wa.me/919876543210?text=hi%20there')
    expect(smsUrl('9876543210', 'a b')).toBe('sms:+919876543210?body=a%20b')
    expect(whatsappUrl('x', 'hi')).toBeNull()
  })

  test('a reminder names the amount, the bill and when it was due, and includes a pay link once a UPI id is set', () => {
    let s = baseState()
    s = apply(s, dueSale(s, NOW))
    const late = NOW + 40 * DAY
    const plain = buildReminder(s, 'c1', late)!
    expect(plain.total).toBe(1998)
    expect(plain.overdue).toBe(1998)
    expect(plain.upi).toBeNull()
    expect(plain.text).toContain('₹1,998')
    expect(plain.text).toContain('Test Store')
    s = withSettings(s)
    const polite = buildReminder(s, 'c1', late)!
    expect(polite.upi).toContain('upi://pay?pa=asha%40okbank')
    expect(polite.upi).toContain('am=1998.00')
    expect(polite.text).toContain(polite.upi!)
    expect(polite.text).toContain('gentle reminder')
    const firm = buildReminder(s, 'c1', late, { tone: 'firm' })!
    expect(firm.text).toContain('overdue by 10 days')
    expect(firm.text).not.toContain('gentle')
    expect(polite.whatsapp).toMatch(/^https:\/\/wa\.me\/91/)
    // nothing owed → nothing to send
    expect(buildReminder(baseState(), 'c1', late)).toBeNull()
  })

  test('the queue holds only customers past their due date, biggest first', () => {
    let s = baseState()
    s = apply(s, dueSale(s, NOW))
    expect(reminderQueue(s, NOW + 5 * DAY)).toEqual([]) // 30 days to pay: not yet late
    const q = reminderQueue(s, NOW + 45 * DAY)
    expect(q.map((r) => r.customerId)).toEqual(['c1'])
    expect(q[0].oldestDaysOverdue).toBe(15)
    // paying it off clears the queue
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 1998, mode: 'cash' }, ctx({ now: NOW + 46 * DAY })))
    expect(reminderQueue(s, NOW + 47 * DAY)).toEqual([])
  })

  test('a payment request needs a UPI id; with one it is the link, the text and the share URLs', () => {
    let s = baseState()
    expect(paymentRequest(s, { amount: 500, note: 'Bill 1' }).upi).toBeNull()
    s = withSettings(s)
    const r = paymentRequest(s, { amount: 500, note: 'Bill 1', ref: 'INV-1', phone: '9876543210' })
    expect(r.upi).toContain('am=500.00')
    expect(r.upi).toContain('tr=INV-1')
    expect(r.text).toContain('₹500')
    expect(r.whatsapp).toContain('wa.me/919876543210')
    expect(paymentRequest(s, { amount: 0, note: 'x' }).upi).toBeNull()
    // dues
    expect(dueRequest(s, 'c1', NOW)).toBeNull()
    s = apply(s, dueSale(s, NOW))
    expect(dueRequest(s, 'c1', NOW)!.amount).toBe(1998)
  })
})

describe('credit standing and reports', () => {
  test('creditStatus shows owed, room left under the limit, and what is late', () => {
    let s = baseState()
    s = apply(s, saveCustomerTerms(s, 'c1', { creditLimit: 5000, creditDays: 10, blocked: false, notes: '' }, ctx()))
    s = apply(s, dueSale(s, NOW))
    const st = creditStatus(s, 'c1', NOW + 20 * DAY)
    expect(st).toMatchObject({ owed: 1998, limit: 5000, available: 3002, overdue: 1998, oldestDaysOverdue: 10, creditDays: 10, blocked: false })
    expect(creditStatus(s, 'c1', NOW).overdue).toBe(0)
    expect(creditStatus(baseState(), 'c1', NOW)).toMatchObject({ owed: 0, available: null })
  })

  test('the ageing CSV and the statements list every customer and balance', () => {
    let s = baseState()
    s = apply(s, dueSale(s, NOW))
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 500, mode: 'upi', ref: 'U1' }, ctx({ now: NOW + DAY })))
    const csv = agingCsv(s, NOW + 40 * DAY)
    expect(csv.split('\r\n')[0]).toContain('1–30 days')
    expect(csv).toContain('1498')
    expect(csv.trim().split('\r\n').at(-1)).toMatch(/^Total/)
    const st = recentStatement(s, 'c1', NOW + 2 * DAY)
    expect(st.closing).toBe(1498)
    expect(statementCsv(s, st)).toContain('Closing balance')
    expect(statementText(s, st)).toContain('You owe: ₹1,498')
    expect(receivablesSummary(s, NOW + 40 * DAY)).toEqual({ total: 1498, overdue: 1498, customers: 1, overdueCustomers: 1 })
  })

  test('the Home figure is worked out again only when the documents change', () => {
    let s = baseState()
    expect(overdueNow(s, NOW)).toEqual({ customers: 0, amount: 0 })
    s = apply(s, dueSale(s, NOW))
    const a = overdueNow(s, NOW + 40 * DAY)
    expect(a).toEqual({ customers: 1, amount: 1998 })
    expect(overdueNow(s, NOW + 40 * DAY)).toBe(a) // memoised
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 1998, mode: 'cash' }, ctx({ now: NOW + 41 * DAY })))
    expect(overdueNow(s, NOW + 41 * DAY)).toEqual({ customers: 0, amount: 0 })
  })
})

describe('postings', () => {
  const sum = (ps: ReturnType<typeof postingsFor>, f: (p: ReturnType<typeof postingsFor>[number]) => boolean) =>
    ps.filter(f).reduce((a, p) => a + p.lines.reduce((x, l) => x + (l.debit ?? 0) - (l.credit ?? 0), 0), 0)

  test('each rule is balanced, and money goes to the right account', () => {
    let s = baseState()
    s = apply(s, dueSale(s, NOW))
    const rc = recordCollection(s, { customerId: 'c1', amount: 2500, mode: 'cheque', ref: '000123' }, ctx({ now: NOW + 1 }))
    const p = collectionPosting(rc.collection)!
    expect(isBalanced(p)).toBe(true)
    expect(p.lines).toEqual([{ account: 'bank', debit: 2500 }, { account: 'receivables', credit: 2500, party: { type: 'customer', id: 'c1' } }])
    const gc = issueGiftCard(s, { value: 750, mode: 'upi', code: 'GC-TEST' }, ctx())
    const g = giftCardTxnPosting(gc.txn)!
    expect(isBalanced(g)).toBe(true)
    expect(g.lines.map((l) => l.account)).toEqual(['upi', 'gift_cards'])
    const rf = refundToGiftCard(apply(s, gc), gc.card.id, 100, undefined, ctx())
    expect(giftCardTxnPosting(rf.txn)!.lines.map((l) => l.account)).toEqual(['suspense', 'gift_cards'])
    expect(giftCardTxnPosting({ ...gc.txn, type: 'redeem' })).toBeNull() // the bill books the spending
    const tu = topUpStoreCredit(s, { customerId: 'c1', amount: 300, mode: 'card' }, ctx())
    const t = topupPosting(tu.topup)!
    expect(isBalanced(t)).toBe(true)
    expect(t.lines.map((l) => l.account)).toEqual(['card', 'store_credit'])
  })

  test('the books agree with the documents: receivables per customer = what they owe, gift cards = what is on the cards', () => {
    let s = baseState()
    s = apply(s, dueSale(s, NOW, { paidNow: 300 }))
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 1000, mode: 'cash' }, ctx({ now: NOW + 1 })))
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 5000, mode: 'bank' }, ctx({ now: NOW + 2 }))) // pays ahead
    const issued = issueGiftCard(s, { value: 1000, mode: 'cash', code: 'GC-BOOKS' }, ctx({ now: NOW + 3 }))
    s = apply(s, issued)
    s = apply(s, rechargeGiftCard(s, issued.card.id, 200, 'upi', ctx({ now: NOW + 4 })))
    const b = billInput(s, [line(s.variants.v1, 1)])
    s = apply(s, saveBill(s, { ...b, payments: [{ mode: 'giftcard', amount: 400, ref: 'GC-BOOKS' }, { mode: 'cash', amount: b.total - 400 }], paid: b.total, date: NOW + 5 }, ctx({ now: NOW + 5 })))
    s = apply(s, topUpStoreCredit(s, { customerId: 'c1', amount: 250, mode: 'upi' }, ctx({ now: NOW + 6 })))

    const ps = postingsFor(s)
    expect(ps.every(isBalanced)).toBe(true)
    const rcv = ps.flatMap((p) => p.lines).filter((l) => l.account === 'receivables' && l.party?.id === 'c1').reduce((a, l) => a + (l.debit ?? 0) - (l.credit ?? 0), 0)
    expect(Math.round(rcv * 100) / 100).toBe(netDue(receivables(s), 'c1'))
    expect(netDue(receivables(s), 'c1')).toBeLessThan(0) // an advance
    const gift = -ps.flatMap((p) => p.lines).filter((l) => l.account === 'gift_cards').reduce((a, l) => a + (l.debit ?? 0) - (l.credit ?? 0), 0)
    expect(Math.round(gift * 100) / 100).toBe(giftCardBalance(s, issued.card.id))
    expect(giftCardBalance(s, issued.card.id)).toBe(800)
    expect(sum(ps, (p) => p.sourceColl === 'collections')).toBe(0)
  })
})

describe('gift-card code from the checkout panel', () => {
  test('a gift-card payment with no reference uses the code the panel saved on the bill', () => {
    let s = baseState()
    s = apply(s, issueGiftCard(s, { value: 600, mode: 'cash', code: 'GC-PANEL' }, ctx()))
    const b = billInput(s, [line(s.variants.v1, 1)])
    const payments: Payment[] = [{ mode: 'giftcard', amount: 600 }, { mode: 'cash', amount: b.total - 600 }]
    const bill = { ...b, payments, paid: b.total, ext: { credit: { giftCode: ' gc-panel ' } } }
    expect(giftCodeOf(bill, payments[0])).toBe('GC-PANEL')
    expect(giftCodeOf({ ...bill, ext: {} }, { ref: 'gc-x' })).toBe('GC-X')
    const r = saveBill(s, bill, ctx({ now: NOW + 1 }))
    s = apply(s, r)
    expect(giftCardBalance(s, findGiftCard(s, 'GC-PANEL')!.id)).toBe(0)
    expect(receiptLines(r.bill, s)).toEqual(['Gift card …ANEL used ₹600'])
    // no code anywhere → refused with a clear message
    expect(() => saveBill(s, { ...b, payments, paid: b.total }, ctx({ now: NOW + 2 }))).toThrow('Enter the gift card code.')
  })

  test('the server ends up with the same cards, entries and customer balance', async () => {
    const r = rig(baseState())
    await r.seed()
    await r.run((s) => issueGiftCard(s, { value: 600, mode: 'cash', code: 'GC-RIG' }, ctx({ now: NOW + 1 })))
    await r.run((s) => {
      const b = billInput(s, [line(s.variants.v1, 1)], { customerId: 'c1' })
      return saveBill(s, { ...b, payments: [{ mode: 'giftcard', amount: 600 }, { mode: 'due', amount: b.total - 600 }], paid: 600, ext: { credit: { giftCode: 'GC-RIG' } } }, ctx({ now: NOW + 2 }))
    })
    const server = await r.serverView()
    expect(server.giftCardTxns).toEqual(r.phone.giftCardTxns)
    expect(server.customers.c1).toEqual(r.phone.customers.c1)
    expect(server.customers.c1.dueBalance).toBe(netDue(receivables(r.phone), 'c1'))
    expect(server.customers.c1.dueBalance).toBe(399)
  })
})
