import { listOf } from '@/data/state'
import { endOfDay } from '@/domain/dates'
import { mutationsFromChanges } from '@/replication/client'
import { actorWith, rig } from '@/replication/testkit'
import { buildLedger, trialBalance } from '../ledger'
import { addPeriodLock, closeYear, createVoucher, removeLatestLock, reverseVoucher, saveAccount, saveFinancialYear, seedChart } from '../ops'
import { baseState, ctx, DAY, NOW, trading } from './helpers'

const journal = (date: number, amount = 10) => ({ type: 'journal' as const, date, narration: 'test', lines: [{ account: 'cash', debit: amount }, { account: 'owner_capital', credit: amount }] })
let seq = 0
const muts = (state: ReturnType<typeof baseState>, changes: Parameters<typeof mutationsFromChanges>[1]) => mutationsFromChanges(state, changes, { deviceId: 'late', nextSeq: () => ++seq })

describe('accounting replicates', () => {
  test('chart, vouchers, years and locks reach the server exactly as they are on the phone', async () => {
    const r = rig(trading()); await r.seed()
    await r.run((s) => seedChart(s, ctx()))
    await r.run((s) => saveAccount(s, { code: '6500', name: 'Travel', type: 'expense', openingBalance: 0, active: true }, undefined, ctx()))
    const v = await r.run((s) => createVoucher(s, journal(NOW), ctx()))
    await r.run((s) => reverseVoucher(s, v.voucher.id, ctx()))
    const y = await r.run((s) => saveFinancialYear(s, { label: 'FY 2025-26', start: new Date(2025, 3, 1).getTime(), end: endOfDay(new Date(2026, 2, 31)) }, undefined, ctx()))
    await r.run((s) => closeYear(s, y.year.id, ctx()))
    const lock = await r.run((s) => addPeriodLock(s, endOfDay(NOW - 20 * DAY), 'Sept', ctx()))
    const view = await r.serverView()
    for (const k of ['accounts', 'vouchers', 'financialYears', 'periodLocks'] as const) expect(view[k]).toEqual(r.phone[k])
    expect(listOf(view.vouchers)).toHaveLength(2)
    expect(listOf(view.periodLocks)).toHaveLength(2)
    // A fresh device computes the same books.
    expect(trialBalance(buildLedger(view))).toEqual(trialBalance(buildLedger(r.phone)))
    await r.run((s) => removeLatestLock(s, ctx()))
    expect(listOf((await r.serverView()).periodLocks).map((l) => l.id)).not.toContain(lock.lock.id)
    expect((await r.serverView()).periodLocks).toEqual(r.phone.periodLocks)
  })

  test('the server refuses a back-dated voucher inside a locked period, even from a phone that does not know of the lock', async () => {
    const r = rig(baseState()); await r.seed()
    const staleState = r.phone
    await r.run((s) => addPeriodLock(s, endOfDay(NOW - 10 * DAY), 'closed', ctx()))
    const stale = createVoucher(staleState, journal(NOW - 12 * DAY), ctx())
    await expect(r.send(muts(staleState, stale.changes).filter((m) => m.coll === 'vouchers'))).rejects.toThrow('locked period')
    expect((await r.serverView()).vouchers).toEqual({})
    // Recent dates still go through, and the lock's own day is the boundary.
    await r.send(muts(staleState, createVoucher(staleState, journal(NOW - 9 * DAY), ctx()).changes).filter((m) => m.coll === 'vouchers'))
    expect(listOf((await r.serverView()).vouchers)).toHaveLength(1)
    const edge = createVoucher(staleState, journal(endOfDay(NOW - 10 * DAY)), ctx())
    await expect(r.send(muts(staleState, edge.changes).filter((m) => m.coll === 'vouchers'))).rejects.toThrow('locked period')
  })

  test('unlocking reopens the period on the server too', async () => {
    const r = rig(baseState()); await r.seed()
    const before = r.phone
    await r.run((s) => addPeriodLock(s, endOfDay(NOW - 10 * DAY), '', ctx()))
    const stale = createVoucher(before, journal(NOW - 12 * DAY), ctx())
    await expect(r.send(muts(before, stale.changes).filter((m) => m.coll === 'vouchers'))).rejects.toThrow('locked period')
    await r.run((s) => removeLatestLock(s, ctx()))
    await r.send(muts(before, stale.changes).filter((m) => m.coll === 'vouchers'))
    expect(listOf((await r.serverView()).vouchers)).toHaveLength(1)
  })

  test('who may do what', async () => {
    const r = rig(baseState()); await r.seed()
    const cashier = actorWith(['pos'])
    const manager = actorWith(['accounting'])
    const base = baseState()
    const v = createVoucher(base, journal(NOW), ctx())
    const asCashier = await r.send(muts(base, v.changes).filter((m) => m.coll === 'vouchers'), cashier).catch((e: Error) => e.message)
    expect(String(asCashier)).toContain('forbidden')
    expect(listOf((await r.serverView(cashier)).vouchers ?? {})).toHaveLength(0)
    // A manager posts vouchers but cannot lock a period or close a year; only the owner does.
    await r.send(muts(base, v.changes).filter((m) => m.coll === 'vouchers'), manager)
    const lock = addPeriodLock(base, NOW, '', ctx())
    await expect(r.send(muts(base, lock.changes).filter((m) => m.coll === 'periodLocks'), manager)).rejects.toThrow('forbidden')
    expect(listOf((await r.serverView(manager)).vouchers)).toHaveLength(1)
  })

  test('a posted voucher cannot be edited or deleted', async () => {
    const r = rig(baseState()); await r.seed()
    const v = await r.run((s) => createVoucher(s, journal(NOW), ctx()))
    const patch = { mid: 'x1', coll: 'vouchers', id: v.voucher.id, op: 'patch' as const, data: { narration: 'changed' }, at: 1 }
    const del = { mid: 'x2', coll: 'vouchers', id: v.voucher.id, op: 'delete' as const, at: 2 }
    await expect(r.send([patch])).rejects.toThrow('immutable')
    await expect(r.send([del])).rejects.toThrow('immutable')
    expect((await r.serverView()).vouchers[v.voucher.id].narration).toBe('test')
  })
})
