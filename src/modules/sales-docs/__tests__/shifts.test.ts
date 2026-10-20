import { billInput, line } from '@/data/__tests__/helpers'
import { saveBill } from '@/data/ops'
import { listOf, type DataState } from '@/data/state'
import { applyMutations } from '@/replication'
import { actorWith, rig } from '@/replication/testkit'
import { isBalanced, postingsFor } from '@/modules/postings'
import { openShiftFor, shiftFigures, varianceLabel } from '../logic/shifts'
import { shiftHtml, shiftText } from '../html'
import { addCashMove, closeShift, openShift, saveSalesOrder, takeOrderPayment, refundOrderPayment } from '../ops'
import { baseState, commit, ctx, dl, NOW } from './helpers'

const owner = (over = {}) => ctx({ userId: 'u_owner', ...over })
const cashierCtx = (over = {}) => ctx({ userId: 'u_cash', ...over })

/** An open shift for the owner with ₹1,000 float. */
function shiftOpen() {
  let s = baseState()
  const sh = openShift(s, 1000, ' morning ', owner({ now: NOW + 1 }))
  s = commit(s, sh)
  return { s, id: sh.shift.id }
}

function sellCash(s: DataState, qty: number, at: number, userId = 'u_owner', payments?: Array<{ mode: string; amount: number }>) {
  const input = billInput(s, [line(s.variants.v1, qty)], { cashierId: userId, soldBy: userId, ...(payments ? { payments, paid: payments.reduce((t, p) => t + p.amount, 0) } : {}) })
  return commit(s, saveBill(s, { ...input, date: at }, ctx({ now: at, userId })))
}

describe('shifts', () => {
  test('a shift opens with a float, one per person, and is numbered', () => {
    const { s, id } = shiftOpen()
    expect(s.shifts[id]).toMatchObject({ no: 'SH-0001', status: 'open', openingCash: 1000, note: 'morning', userId: 'u_owner' })
    expect(openShiftFor(s, 'u_owner')?.id).toBe(id)
    expect(openShiftFor(s, 'u_cash')).toBeUndefined()
    expect(() => openShift(s, 0, '', owner())).toThrow('already have a shift open')
    expect(() => openShift(baseState(), -5, '', owner())).toThrow('Enter the cash')
    expect(openShift(s, 0, '', cashierCtx()).shift.no).toBe('SH-0002')
  })

  test('what should be in the drawer: float + cash sales + cash in − cash out − cash expenses; others’ sales do not count', () => {
    let { s, id } = shiftOpen()
    s = sellCash(s, 2, NOW + 10) // ₹1,998 cash
    s = sellCash(s, 1, NOW + 11, 'u_cash') // someone else's till
    s = sellCash(s, 1, NOW + 12, 'u_owner', [{ mode: 'upi', amount: 999 }]) // not cash
    s = commit(s, addCashMove(s, id, { kind: 'in', amount: 500, reason: 'Float top-up' }, owner({ now: NOW + 20 })))
    s = commit(s, addCashMove(s, id, { kind: 'out', amount: 300, reason: 'Bank deposit' }, owner({ now: NOW + 21 })))
    s = commit(s, { put: { expenses: [{ id: 'e1', date: NOW + 22, category: 'Tea', amount: 80, mode: 'cash', vendor: '', note: '', recurring: false, userId: 'u_owner' }] } })
    const f = shiftFigures(s, id, NOW + 100)!
    expect(f).toMatchObject({ opening: 1000, cashSales: 1998, payIns: 500, payOuts: 300, cashExpenses: 80, bills: 2, expected: 3118 })
    expect(f.byMode).toEqual([{ mode: 'cash', amount: 1998 }, { mode: 'upi', amount: 999 }])
    expect(f.moves.map((m) => m.kind)).toEqual(['in', 'out'])
    expect(shiftFigures(s, 'nope', NOW)).toBeNull()
  })

  test('cash taken for orders counts in the drawer; cash given back comes out', () => {
    let { s, id } = shiftOpen()
    const o = saveSalesOrder(s, { customerId: 'c1', items: [dl(s, 'v1', 2)], billDiscountType: 'amt', billDiscountValue: 0, notes: '' }, undefined, owner({ now: NOW + 5 })).order
    s = commit(s, { put: { salesOrders: [o] } })
    s = commit(s, takeOrderPayment(s, o.id, { amount: 700, mode: 'cash' }, owner({ now: NOW + 6 })))
    s = commit(s, takeOrderPayment(s, o.id, { amount: 300, mode: 'upi' }, owner({ now: NOW + 7 })))
    s = commit(s, refundOrderPayment(s, o.id, { amount: 100, mode: 'cash' }, owner({ now: NOW + 8 })))
    expect(shiftFigures(s, id, NOW + 50)).toMatchObject({ cashOther: 600, expected: 1600 })
  })

  test('cash out cannot exceed what is in the drawer; amounts and reasons are required; closed shifts take nothing', () => {
    const { s, id } = shiftOpen()
    expect(() => addCashMove(s, id, { kind: 'out', amount: 1500, reason: 'Bank deposit' }, owner())).toThrow('only be ₹1000 in the drawer')
    expect(() => addCashMove(s, id, { kind: 'in', amount: 0, reason: 'x' }, owner())).toThrow('Enter the amount')
    expect(() => addCashMove(s, id, { kind: 'in', amount: 5, reason: ' ' }, owner())).toThrow('what the cash was for')
    expect(() => addCashMove(s, 'nope', { kind: 'in', amount: 5, reason: 'x' }, owner())).toThrow('no longer exists')
    const closed = commit(s, closeShift(s, id, 1000, '', owner({ now: NOW + 30 })))
    expect(() => addCashMove(closed, id, { kind: 'in', amount: 5, reason: 'x' }, owner())).toThrow('closed')
    expect(() => closeShift(closed, id, 1000, '', owner())).toThrow('no open shift')
  })

  test('closing records what was expected, counted and the difference, and the report says it', () => {
    let { s, id } = shiftOpen()
    s = sellCash(s, 1, NOW + 10)
    expect(() => closeShift(s, id, -1, '', owner())).toThrow('Count the drawer')
    const r = closeShift(s, id, 1900, ' short ', owner({ now: NOW + 40 }))
    expect(r.shift).toMatchObject({ status: 'closed', expectedCash: 1999, countedCash: 1900, variance: -99, closedAt: NOW + 40, note: 'short' })
    expect(varianceLabel(-99)).toBe('Short by ₹99')
    expect(varianceLabel(5)).toBe('Over by ₹5')
    expect(varianceLabel(0)).toBe('Exact')
    s = commit(s, r)
    // Sales after closing are outside the shift.
    s = sellCash(s, 1, NOW + 60)
    const f = shiftFigures(s, id, NOW + 100)!
    expect(f.expected).toBe(1999)
    const html = shiftHtml(s.shifts[id], f, s.store!, 'Asha <b>')
    expect(html).toContain('Shift report')
    expect(html).toContain('Asha &lt;b&gt;')
    expect(html).toContain('Difference')
    expect(shiftText(s.shifts[id], f, 'Test Store', 'Asha')).toContain('Counted: ₹1,900')
  })

  test('cash in and out post balanced entries through suspense', () => {
    let { s, id } = shiftOpen()
    s = commit(s, addCashMove(s, id, { kind: 'in', amount: 250, reason: 'Owner put in' }, owner({ now: NOW + 3 })))
    s = commit(s, addCashMove(s, id, { kind: 'out', amount: 100, reason: 'Petty cash' }, owner({ now: NOW + 4 })))
    const ps = postingsFor(s).filter((p) => p.sourceColl === 'cashMoves')
    expect(ps).toHaveLength(2)
    expect(ps.every(isBalanced)).toBe(true)
    expect(ps[0].lines).toEqual([{ account: 'cash', debit: 250 }, { account: 'suspense', credit: 250 }])
    expect(ps[1].lines).toEqual([{ account: 'suspense', debit: 100 }, { account: 'cash', credit: 100 }])
  })

  test('the server ends up with the shifts and cash moves; a posted move cannot be edited', async () => {
    const r = rig(baseState())
    await r.seed()
    const sh = await r.run((s) => openShift(s, 500, '', owner({ now: NOW + 1 })))
    const mv = await r.run((s) => addCashMove(s, sh.shift.id, { kind: 'in', amount: 200, reason: 'Float top-up' }, owner({ now: NOW + 2 })))
    await r.run((s) => addCashMove(s, sh.shift.id, { kind: 'out', amount: 50, reason: 'Tea & snacks' }, owner({ now: NOW + 3 })))
    await r.run((s) => closeShift(s, sh.shift.id, 650, '', owner({ now: NOW + 4 })))
    const server = await r.serverView()
    expect(server.shifts).toEqual(r.phone.shifts)
    expect(server.cashMoves).toEqual(r.phone.cashMoves)
    expect(listOf(server.cashMoves)).toHaveLength(2)
    expect(server.shifts[sh.shift.id]).toMatchObject({ status: 'closed', variance: 0 })
    const res = await applyMutations(r.db, [{ mid: 'x:1', coll: 'cashMoves', id: mv.move.id, op: 'patch', data: { amount: 1 }, at: 1 }], actorWith('all'))
    expect(res[0]).toMatchObject({ status: 'rejected', code: 'immutable' })
    // A cashier may run a till.
    const own = await applyMutations(r.db, [{ mid: 'y:1', coll: 'shifts', id: 'sh_c', op: 'create', data: { id: 'sh_c', no: 'SH-9', userId: 'u_cash', openedAt: NOW, openingCash: 0, status: 'open', note: '' }, at: 1 }], actorWith(['pos'], 'u_cash'))
    expect(own[0].status).toBe('ok')
  })
})
