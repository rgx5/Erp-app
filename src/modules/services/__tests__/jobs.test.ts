import { listOf } from '@/data/state'
import { postingsFor } from '@/modules/postings'
import '@/modules/accounting/postings'
import { jobAgeing, jobBoard, jobTotals, readyText, estimateText, uncollected, toIssue, isLate } from '../logic/jobs'
import { billJobCard, issuePart, returnPart, saveJobCard, setJobLines, setJobStatus } from '../ops'
import type { JobLine } from '../types'
import { ctx, DAY, NOW, PART, run, shopState } from './helpers'

const draft = (over = {}) => ({
  customerId: 'c1' as string | null, partyName: '', partyPhone: '', kind: 'device' as const, title: 'Redmi Note 12', identifier: '356938035643809', reading: 'Battery 82%', accessories: 'Charger, cover',
  condition: 'Scratch on back', problem: 'Screen cracked', photos: ['file:///a.jpg', 'file:///b.jpg'], promisedAt: NOW + 2 * DAY, notes: '', ...over,
})
const labour = (price: number, id = 'l1'): JobLine => ({ id, kind: 'labour', name: 'Screen replacement', qty: 1, price })
const part = (qty: number, price = 2000, id = 'p1'): JobLine => ({ id, kind: 'part', name: 'Phone screen', qty, price, variantId: PART })

/** A job taken in, estimated (labour 500 + screen 2000) and approved. */
function approved() {
  let s = shopState()
  const j = run(s, saveJobCard(s, draft(), undefined, ctx()))
  s = j.state
  const id = j.result.job.id
  s = run(s, setJobLines(s, id, [labour(500), part(1)], ctx())).state
  s = run(s, setJobStatus(s, id, 'estimated', ctx())).state
  s = run(s, setJobStatus(s, id, 'approved', ctx(), { approvedBy: 'Meera, by phone' })).state
  return { s, id }
}

describe('intake', () => {
  test('a job card records the device, photos and the problem, and gets a number', () => {
    const s = shopState()
    const r = saveJobCard(s, draft(), undefined, ctx())
    expect(r.job).toMatchObject({ no: 'JC-0001', status: 'received', partyName: 'Meera', partyPhone: '9876543210', identifier: '356938035643809', photos: ['file:///a.jpg', 'file:///b.jpg'], lines: [] })
    const s2 = run(s, r).state
    expect(saveJobCard(s2, draft(), undefined, ctx()).job.no).toBe('JC-0002')
    const e = run(s2, saveJobCard(s2, draft({ problem: 'Screen and speaker' }), r.job.id, ctx()))
    expect(e.result.job).toMatchObject({ no: 'JC-0001', problem: 'Screen and speaker' })
  })

  test('refusals: no problem, no item, no owner, too many photos', () => {
    const s = shopState()
    expect(() => saveJobCard(s, draft({ problem: ' ' }), undefined, ctx())).toThrow('what is wrong')
    expect(() => saveJobCard(s, draft({ title: '' }), undefined, ctx())).toThrow('what the item is')
    expect(() => saveJobCard(s, draft({ customerId: null, partyName: '' }), undefined, ctx())).toThrow('whose item')
    expect(() => saveJobCard(s, draft({ photos: Array(13).fill('x') }), undefined, ctx())).toThrow('12 photos')
    expect(saveJobCard(s, draft({ customerId: null, partyName: 'Walk-in', partyPhone: '9' }), undefined, ctx()).job.partyName).toBe('Walk-in')
  })
})

describe('estimate → approval → work → ready', () => {
  test('the flow, with the approver recorded and the approved total remembered', () => {
    const { s, id } = approved()
    expect(s.jobCards[id]).toMatchObject({ status: 'approved', approvedBy: 'Meera, by phone', approvedTotal: 2500 })
    expect(jobTotals(s.jobCards[id])).toEqual({ labour: 500, parts: 2000, total: 2500 })
    const w = run(s, setJobStatus(s, id, 'in_work', ctx()))
    expect(w.state.jobCards[id].startedAt).toBe(NOW)
    expect(() => setJobStatus(s, id, 'delivered', ctx())).toThrow('cannot become')
  })

  test('an estimate needs lines; approval needs a name; a refusal needs a reason; a refused job can be reopened or handed back', () => {
    let s = shopState()
    const j = run(s, saveJobCard(s, draft(), undefined, ctx()))
    s = j.state
    const id = j.result.job.id
    expect(() => setJobStatus(s, id, 'estimated', ctx())).toThrow('Add the labour')
    s = run(s, setJobLines(s, id, [labour(500)], ctx())).state
    s = run(s, setJobStatus(s, id, 'estimated', ctx())).state
    expect(() => setJobStatus(s, id, 'approved', ctx())).toThrow('who approved')
    expect(() => setJobStatus(s, id, 'rejected', ctx())).toThrow('why')
    s = run(s, setJobStatus(s, id, 'rejected', ctx(), { reason: 'Too costly' })).state
    expect(s.jobCards[id].rejectReason).toBe('Too costly')
    const back = run(s, setJobStatus(s, id, 'estimated', ctx()))
    expect(back.state.jobCards[id].rejectReason).toBeUndefined()
    s = run(s, setJobStatus(s, id, 'delivered', ctx(), { receivedBy: 'Meera' })).state
    expect(s.jobCards[id]).toMatchObject({ status: 'delivered', receivedBy: 'Meera' })
    expect(() => setJobStatus(s, id, 'in_work', ctx())).toThrow('cannot become')
  })

  test('more work after approval needs a new approval; the same total does not', () => {
    const { s, id } = approved()
    const same = run(s, setJobLines(s, id, [labour(600), part(1, 1900)], ctx()))
    expect(same.state.jobCards[id].status).toBe('approved')
    const more = run(s, setJobLines(s, id, [labour(500), part(1), { ...labour(300, 'l2'), name: 'Extra' }], ctx()))
    expect(more.state.jobCards[id]).toMatchObject({ status: 'estimated' })
    expect(more.state.jobCards[id].approvedBy).toBeUndefined()
  })

  test('lines are checked', () => {
    const { s, id } = approved()
    expect(() => setJobLines(s, id, [{ ...labour(10), name: '' }], ctx())).toThrow('needs a name')
    expect(() => setJobLines(s, id, [{ ...part(1), variantId: undefined }], ctx())).toThrow('choose the part')
    expect(() => setJobLines(s, id, [{ ...labour(10), qty: 0 }], ctx())).toThrow('quantity')
    expect(() => setJobLines(s, id, [part(1, -5)], ctx())).toThrow('negative')
  })
})

describe('parts from stock', () => {
  test('issuing a part writes a stock movement and lowers stock; it needs approval first', () => {
    const { s, id } = approved()
    expect(s.variants[PART].stock).toBe(5)
    const r = run(s, issuePart(s, id, 'p1', 1, ctx()))
    expect(r.state.variants[PART].stock).toBe(4)
    expect(r.state.jobCards[id].lines.find((l) => l.id === 'p1')!.issued).toBe(1)
    const mv = listOf(r.state.moves).find((m) => m.ref === 'JC-0001')!
    expect(mv).toMatchObject({ variantId: PART, qty: -1, type: 'adjust' })
    expect(toIssue(r.state.jobCards[id])).toHaveLength(0)
    expect(() => issuePart(r.state, id, 'p1', 1, ctx())).toThrow('more is needed')
    // not before approval
    let t = shopState()
    const j = run(t, saveJobCard(t, draft(), undefined, ctx()))
    t = run(j.state, setJobLines(j.state, j.result.job.id, [part(1)], ctx())).state
    expect(() => issuePart(t, j.result.job.id, 'p1', 1, ctx())).toThrow('once the customer has approved')
  })

  test('not more than is in stock; a returned part goes back; an issued part cannot be dropped from the lines', () => {
    const { s: s0, id } = approved()
    let s = run(s0, setJobLines(s0, id, [labour(500), part(9)], ctx())).state
    expect(s.jobCards[id].status).toBe('estimated') // more than was approved
    s = run(s, setJobStatus(s, id, 'approved', ctx(), { approvedBy: 'Meera' })).state
    expect(() => issuePart(s, id, 'p1', 6, ctx())).toThrow('Only 5')
    s = run(s, issuePart(s, id, 'p1', 2, ctx())).state
    expect(() => setJobLines(s, id, [labour(500)], ctx())).toThrow('give the parts back')
    expect(() => returnPart(s, id, 'p1', 3, ctx())).toThrow('only 2')
    s = run(s, returnPart(s, id, 'p1', 2, ctx())).state
    expect(s.variants[PART].stock).toBe(5)
    expect(s.jobCards[id].lines.find((l) => l.id === 'p1')!.issued).toBeUndefined()
    expect(() => setJobLines(s, id, [labour(500)], ctx())).not.toThrow()
  })

  test('it cannot be marked ready with parts still to take, or cancelled with parts out', () => {
    const { s, id } = approved()
    let t = run(s, setJobStatus(s, id, 'in_work', ctx())).state
    expect(() => setJobStatus(t, id, 'ready', ctx())).toThrow('Take the parts')
    t = run(t, issuePart(t, id, 'p1', 1, ctx())).state
    t = run(t, setJobStatus(t, id, 'ready', ctx())).state
    expect(t.jobCards[id].readyAt).toBe(NOW)
    expect(() => setJobStatus(t, id, 'cancelled', ctx())).toThrow('cannot become')
  })
})

describe('convert to invoice', () => {
  function ready() {
    let { s, id } = approved()
    s = run(s, setJobStatus(s, id, 'in_work', ctx())).state
    s = run(s, issuePart(s, id, 'p1', 1, ctx())).state
    s = run(s, setJobStatus(s, id, 'ready', ctx())).state
    return { s, id }
  }

  test('the bill has labour and parts, stock leaves once, the job is delivered and linked', () => {
    const { s, id } = ready()
    expect(s.variants[PART].stock).toBe(4)
    const r = run(s, billJobCard(s, id, [{ mode: 'cash', amount: 2500 }], ctx({ now: NOW + 3_600_000 }), { receivedBy: 'Meera' }))
    const bill = r.result.bill
    expect(bill.total).toBe(2500)
    expect(bill.items.map((i) => i.name)).toEqual(['Screen replacement', 'Phone screen'])
    expect(bill.ext).toEqual({ services: { jobCardId: id } })
    expect(r.state.variants[PART].stock).toBe(4) // issued once (5 → 4), not twice
    expect(r.state.jobCards[id]).toMatchObject({ status: 'delivered', billId: bill.id, receivedBy: 'Meera' })
    // labour item made, with no stock
    const labourItem = r.state.variants['var_svc_labour']
    expect(labourItem).toBeTruthy()
    expect(r.state.products[labourItem.productId].trackStock).toBe(false)
    expect(bill.items[0].variantId).toBe('var_svc_labour')
    // the cost of the screen is on the bill line, so profit reports see it
    expect(bill.items[1].cost).toBe(900)
    // the ledger: issue, put-back and the sale — net minus one
    const net = listOf(r.state.moves).filter((m) => m.variantId === PART).reduce((n, m) => n + m.qty, 0)
    expect(net).toBe(-1)
    // the books: the sale posts; nothing else from the job's stock movements
    const ps = postingsFor(r.state)
    expect(ps.filter((p) => p.sourceColl === 'moves')).toHaveLength(0)
    expect(ps.filter((p) => p.sourceColl === 'bills')).toHaveLength(1)
    expect(() => billJobCard(r.state, id, [{ mode: 'cash', amount: 2500 }], ctx())).toThrow('already been billed')
  })

  test('a part not yet issued is taken by the bill; billing needs a ready job and enough stock', () => {
    let { s, id } = approved()
    expect(() => billJobCard(s, id, [{ mode: 'cash', amount: 2500 }], ctx())).toThrow('when it is ready')
    s = run(s, setJobStatus(s, id, 'in_work', ctx())).state
    s = run(s, setJobLines(s, id, [labour(500), part(1)], ctx())).state
    // pretend it was issued by hand, then ready check blocks:
    expect(() => setJobStatus(s, id, 'ready', ctx())).toThrow('Take the parts')
    s = run(s, issuePart(s, id, 'p1', 1, ctx())).state
    s = run(s, setJobStatus(s, id, 'ready', ctx())).state
    const low = { ...s, variants: { ...s.variants, [PART]: { ...s.variants[PART], stock: 0 } } }
    // 0 on the shelf + 1 put back by the bill = enough
    expect(() => billJobCard(low, id, [{ mode: 'cash', amount: 2500 }], ctx())).not.toThrow()
  })

  test('payments must cover the bill; the delivered state needs the bill first', () => {
    const { s, id } = ready()
    expect(() => billJobCard(s, id, [{ mode: 'cash', amount: 1000 }], ctx())).toThrow('less than the bill')
    expect(() => setJobStatus(s, id, 'delivered', ctx())).toThrow('Bill the job')
  })
})

describe('boards and texts', () => {
  test('open jobs by age, late jobs, uncollected ready jobs, and the texts', () => {
    let { s, id } = approved()
    s = run(s, setJobStatus(s, id, 'in_work', ctx())).state
    s = run(s, issuePart(s, id, 'p1', 1, ctx())).state
    const later = NOW + 4 * DAY
    expect(isLate(s.jobCards[id], later)).toBe(true)
    expect(jobBoard(s, later)).toMatchObject({ open: 1, late: 1, openValue: 2500 })
    expect(jobAgeing(s, later).buckets.find((b) => b.label === '3–7 days')!.count).toBe(1)
    s = run(s, setJobStatus(s, id, 'ready', ctx({ now: later }))).state
    expect(uncollected(s, later + 3 * DAY)).toHaveLength(1)
    expect(uncollected(s, later + 1 * DAY)).toHaveLength(0)
    expect(readyText(s.jobCards[id], 'FixIt')).toContain('₹2,500')
    expect(estimateText(s.jobCards[id], 'FixIt')).toContain('Screen replacement')
  })
})
