import { saveBill, OpError } from '@/data/ops'
import { billInput, line } from '@/data/__tests__/helpers'
import { rig } from '@/replication/testkit'
import { listOf } from '@/data/state'
import { fromInputDate } from '@/domain/dates'
import { cartLinesFor } from '../logic/convert'
import { canEditQuote, daysLeft, DEFAULT_TERMS, effectiveStatus, isExpired, quotationText } from '../logic/quotes'
import { quotationHtml } from '../html'
import { deleteQuotation, defaultValidity, extendQuote, saveQuotation, setQuoteStatus } from '../ops'
import { baseState, commit, ctx, dl, NOW, installBillHook } from './helpers'

const draftFor = (s = baseState(), over: Record<string, unknown> = {}) => ({
  customerId: 'c1' as string | null, partyName: '', partyPhone: '', items: [dl(s, 'v1', 2)], billDiscountType: 'amt' as const, billDiscountValue: 0,
  validUntil: defaultValidity(NOW), notes: ' call back ', terms: '', ...over,
})

describe('quotations', () => {
  test('a new quotation is numbered, takes the customer’s details and default terms', () => {
    const s = baseState()
    const { quotation: q } = saveQuotation(s, draftFor(s), undefined, ctx())
    expect(q.no).toBe('QT-0001')
    expect(q.status).toBe('draft')
    expect(q.partyName).toBe('Meera')
    expect(q.partyPhone).toBe('9876543210')
    expect(q.terms).toBe(DEFAULT_TERMS)
    expect(q.notes).toBe('call back')
    expect(saveQuotation(commit(s, saveQuotation(s, draftFor(s), undefined, ctx())), draftFor(s), undefined, ctx()).quotation.no).toBe('QT-0002')
    expect(saveQuotation(s, draftFor(s), undefined, ctx({ series: 'M4X' })).quotation.no).toBe('QT-M4X-0001')
  })

  test('a walk-in enquiry needs a name; items need prices and quantities; the date must not be past', () => {
    const s = baseState()
    expect(() => saveQuotation(s, draftFor(s, { customerId: null }), undefined, ctx())).toThrow('who the quotation is for')
    expect(saveQuotation(s, draftFor(s, { customerId: null, partyName: 'Raj', partyPhone: '98' }), undefined, ctx()).quotation.partyName).toBe('Raj')
    expect(() => saveQuotation(s, draftFor(s, { items: [] }), undefined, ctx())).toThrow('at least one item')
    expect(() => saveQuotation(s, draftFor(s, { items: [dl(s, 'v1', 0)] }), undefined, ctx())).toThrow('quantity')
    expect(() => saveQuotation(s, draftFor(s, { items: [dl(s, 'v1', 1, { price: 0 })] }), undefined, ctx())).toThrow('no price')
    expect(() => saveQuotation(s, draftFor(s, { validUntil: NOW - 3 * 86_400_000 }), undefined, ctx())).toThrow('already past')
  })

  test('expiry is worked out from the date, never written', () => {
    const q = saveQuotation(baseState(), draftFor(), undefined, ctx()).quotation
    expect(isExpired(q, NOW)).toBe(false)
    expect(daysLeft(q, NOW)).toBeGreaterThan(10)
    const later = NOW + 40 * 86_400_000
    expect(isExpired(q, later)).toBe(true)
    expect(effectiveStatus(q, later)).toBe('expired')
    expect(effectiveStatus({ ...q, status: 'converted' }, later)).toBe('converted')
    expect(effectiveStatus({ ...q, status: 'rejected' }, later)).toBe('rejected')
  })

  test('status moves follow rules; extend revives; only a draft is deleted', () => {
    let s = baseState()
    const q = saveQuotation(s, draftFor(s), undefined, ctx()).quotation
    s = commit(s, { put: { quotations: [q] } })
    expect(() => deleteQuotation(commit(s, setQuoteStatus(s, q.id, 'sent', ctx())), q.id, ctx())).toThrow('Only a draft')
    s = commit(s, setQuoteStatus(s, q.id, 'sent', ctx()))
    expect(canEditQuote(s.quotations[q.id])).toBe(true)
    s = commit(s, setQuoteStatus(s, q.id, 'accepted', ctx()))
    expect(canEditQuote(s.quotations[q.id])).toBe(false)
    expect(() => saveQuotation(s, draftFor(s), q.id, ctx())).toThrow('Only a draft or a sent')
    expect(() => setQuoteStatus(s, q.id, 'draft', ctx())).toThrow('cannot become')
    const lapsed = { ...s.quotations[q.id], validUntil: NOW - 5 * 86_400_000, status: 'sent' as const }
    const ext = extendQuote({ ...s, quotations: { [q.id]: lapsed } }, q.id, fromInputDate('2026-12-01'), ctx())
    expect(ext.quotation.validUntil).toBe(fromInputDate('2026-12-01'))
    expect(() => extendQuote(s, q.id, NOW - 9 * 86_400_000, ctx())).toThrow('from today')
  })

  test('the WhatsApp text and the printable page carry the essentials (and escape what people type)', () => {
    const s = baseState()
    const q = { ...saveQuotation(s, draftFor(s), undefined, ctx()).quotation, notes: '<b>fast</b> & easy' }
    const text = quotationText(q, s.store!)
    expect(text).toContain('Quotation QT-0001')
    expect(text).toContain('Hi Meera,')
    expect(text).toContain('Oxford Shirt')
    expect(text).toMatch(/Total: ₹1,998/)
    const html = quotationHtml(q, s.store!, NOW)
    expect(html).toContain('QUOTATION')
    expect(html).toContain('&lt;b&gt;fast&lt;/b&gt; &amp; easy')
    expect(html).not.toContain('<b>fast</b>')
  })

  test('converting: the cart gets the quoted lines, and billing it marks the quotation billed — once', () => {
    installBillHook()
    let s = baseState()
    const q = saveQuotation(s, draftFor(s, { items: [dl(s, 'v1', 2, { price: 900 })] }), undefined, ctx()).quotation
    s = commit(s, { put: { quotations: [q] } })
    const { lines, warnings } = cartLinesFor(s, q.items)
    expect(lines).toHaveLength(1)
    expect(lines[0].price).toBe(900) // the quoted price, not today's 999
    expect(lines[0].stock).toBe(10)
    expect(warnings).toEqual([])
    const short = cartLinesFor(s, [dl(s, 'v2', 9)])
    expect(short.warnings[0]).toMatch(/Only 4 of Oxford Shirt/)
    expect(cartLinesFor({ ...s, variants: {} }, q.items).warnings[0]).toMatch(/no longer sold/)

    const bill = saveBill(s, billInput(s, lines, { customerId: 'c1', ext: { 'sales-docs': { quotationId: q.id } } }), ctx({ now: NOW + 5 }))
    expect(bill.changes.put!.quotations![0]).toMatchObject({ id: q.id, status: 'converted', billId: bill.bill.id })
    const after = commit(s, bill)
    expect(after.quotations[q.id].status).toBe('converted')
    expect(() => saveBill(after, billInput(after, lines, { ext: { 'sales-docs': { quotationId: q.id } } }), ctx())).toThrow(OpError)
    expect(() => saveBill(after, billInput(after, lines, { ext: { 'sales-docs': { quotationId: q.id } } }), ctx())).toThrow('already been billed')
  })
})

describe('quotations replicate', () => {
  test('the server ends up with what the phone has, through every step', async () => {
    installBillHook()
    const r = rig(baseState())
    await r.seed()
    const made = await r.run((s) => saveQuotation(s, draftFor(s), undefined, ctx({ now: NOW + 1 })))
    await r.run((s) => setQuoteStatus(s, made.quotation.id, 'sent', ctx({ now: NOW + 2 })))
    await r.run((s) => setQuoteStatus(s, made.quotation.id, 'accepted', ctx({ now: NOW + 3 })))
    await r.run((s) => saveBill(s, billInput(s, [line(s.variants.v1, 2)], { customerId: 'c1', ext: { 'sales-docs': { quotationId: made.quotation.id } } }), ctx({ now: NOW + 4 })))
    const server = await r.serverView()
    expect(server.quotations).toEqual(r.phone.quotations)
    expect(server.quotations[made.quotation.id].status).toBe('converted')
    expect(listOf(server.bills)).toHaveLength(1)
    const draft = await r.run((s) => saveQuotation(s, draftFor(s), undefined, ctx({ now: NOW + 6 })))
    await r.run((s) => deleteQuotation(s, draft.quotation.id, ctx({ now: NOW + 7 })))
    expect((await r.serverView()).quotations[draft.quotation.id]).toBeUndefined()
  })
})
