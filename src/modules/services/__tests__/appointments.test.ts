import { listOf } from '@/data/state'
import { OpError } from '@/data/ops'
import { apptTotal, confirmationText, daySummary, noShowCount, noShowReport, overdueBookings, reminderText, remindersDue } from '../logic/appointments'
import { bookingProblem, conflicts, dayBoard, freeSlots, utilisation, weekBoard, workWindow } from '../logic/calendar'
import { settingsOf } from '../logic/settings'
import { addDays, at, weekStart, ymd } from '../logic/time'
import { billAppointment, markReminded, saveAppointment, saveResource, setAppointmentStatus } from '../ops'
import { bookDraft, cctx, ctx, mctx, nextDay, NOW, run, shopState, SVC, todayAt, tomorrowAt, TODAY } from './helpers'

const book = (s: ReturnType<typeof shopState>, over = {}, c = ctx()) => run(s, saveAppointment(s, bookDraft(over), undefined, c))

describe('booking', () => {
  test('a booking takes its duration from the services and its price from the item', () => {
    const s = shopState()
    const { result } = book(s, { services: [{ variantId: SVC.cut }, { variantId: SVC.spa }] })
    const a = result.appointment
    expect(a.no).toBe('AP-0001')
    expect(a.end - a.start).toBe(90 * 60_000)
    expect(apptTotal(a)).toBe(1700)
    expect(a.partyName).toBe('Meera')
    expect(a.status).toBe('booked')
  })

  test('two bookings cannot overlap on a column, and the clean-up time counts', () => {
    let s = shopState()
    s = book(s).state // 11:00–11:30 + 10 min clean-up
    expect(() => saveAppointment(s, bookDraft({ start: tomorrowAt('11:15') }), undefined, ctx())).toThrow(OpError)
    expect(() => saveAppointment(s, bookDraft({ start: tomorrowAt('11:35') }), undefined, ctx())).toThrow('already has')
    expect(() => saveAppointment(s, bookDraft({ start: tomorrowAt('11:40') }), undefined, ctx())).not.toThrow()
    // another column is free at the same time
    expect(() => saveAppointment(s, bookDraft({ resourceId: 'res_chair' }), undefined, ctx())).not.toThrow()
  })

  test('a column that does not do the service, a day off and outside hours are refused; a manager may override hours', () => {
    let s = shopState()
    expect(() => saveAppointment(s, bookDraft({ resourceId: 'res_chair', services: [{ variantId: SVC.spa }] }), undefined, ctx())).toThrow('does not do')
    s = run(s, saveResource(s, { name: 'Asha', kind: 'staff', daysOff: [ymd(nextDay(1))], variantIds: [], active: true }, 'res_asha', mctx())).state
    expect(() => saveAppointment(s, bookDraft(), undefined, ctx())).toThrow('not working that day')
    const t = shopState()
    expect(() => saveAppointment(t, bookDraft({ start: tomorrowAt('20:00') }), undefined, ctx())).toThrow('works only between')
    expect(() => saveAppointment(t, bookDraft({ start: tomorrowAt('20:00'), override: true }), undefined, cctx())).toThrow('Only a manager')
    expect(() => saveAppointment(t, bookDraft({ start: tomorrowAt('20:00'), override: true }), undefined, mctx())).not.toThrow()
    expect(() => saveAppointment(t, bookDraft({ start: TODAY - 86_400_000 }), undefined, ctx())).toThrow('already passed')
  })

  test('a customer with too many no-shows needs a manager to book', () => {
    let s = shopState()
    for (const h of ['10:00', '12:00']) {
      s = book(s, { start: tomorrowAt(h) }).state
    }
    const ids = listOf(s.appointments)
    for (const a of ids) s = run(s, setAppointmentStatus(s, a.id, 'no_show', ctx())).state
    expect(noShowCount(s, { customerId: 'c1' })).toBe(2)
    expect(noShowCount(s, { phone: '+91 98765 43210' })).toBe(2) // the same mobile number counts
    expect(() => saveAppointment(s, bookDraft({ start: tomorrowAt('15:00') }), undefined, ctx())).toThrow('missed 2 appointments')
    expect(() => saveAppointment(s, bookDraft({ start: tomorrowAt('15:00'), override: true }), undefined, mctx())).not.toThrow()
    // someone else is unaffected
    expect(() => saveAppointment(s, bookDraft({ customerId: 'c2', start: tomorrowAt('15:00') }), undefined, ctx())).not.toThrow()
    expect(noShowReport(s, 0, Infinity)[0]).toMatchObject({ name: 'Meera', count: 2, of: 2 })
  })

  test('editing moves the booking; only booked/confirmed ones can be edited; a changed time clears the reminder', () => {
    let s = shopState()
    const b = book(s)
    s = b.state
    s = run(s, markReminded(s, b.result.appointment.id, ctx())).state
    expect(s.appointments[b.result.appointment.id].remindedAt).toBe(NOW)
    const moved = run(s, saveAppointment(s, bookDraft({ start: tomorrowAt('14:00') }), b.result.appointment.id, ctx()))
    expect(moved.result.appointment.remindedAt).toBeUndefined()
    expect(moved.result.appointment.no).toBe('AP-0001')
    s = run(moved.state, setAppointmentStatus(moved.state, b.result.appointment.id, 'arrived', ctx())).state
    expect(() => saveAppointment(s, bookDraft(), b.result.appointment.id, ctx())).toThrow('booked or confirmed')
  })
})

describe('status flow', () => {
  test('booked → confirmed → arrived → in service → done, with times; illegal moves are refused', () => {
    let s = shopState()
    const b = book(s)
    const id = b.result.appointment.id
    s = b.state
    for (const to of ['confirmed', 'arrived', 'in_service', 'completed'] as const) s = run(s, setAppointmentStatus(s, id, to, ctx())).state
    const a = s.appointments[id]
    expect(a).toMatchObject({ status: 'completed' })
    expect(a.confirmedAt && a.arrivedAt && a.completedAt).toBeTruthy()
    expect(() => setAppointmentStatus(s, id, 'cancelled', ctx())).toThrow(OpError)
    expect(() => setAppointmentStatus(s, id, 'booked', ctx())).toThrow(OpError)
  })

  test('cancelling keeps the reason and frees the time; a no-show can be undone only by a manager', () => {
    let s = shopState()
    const a = book(s)
    s = a.state
    s = run(s, setAppointmentStatus(s, a.result.appointment.id, 'cancelled', ctx(), { reason: 'Unwell' })).state
    expect(s.appointments[a.result.appointment.id].cancelReason).toBe('Unwell')
    expect(conflicts(s, 'res_asha', tomorrowAt('11:00'), tomorrowAt('11:30'))).toHaveLength(0)
    const b = book(s, { start: tomorrowAt('13:00') })
    s = run(b.state, setAppointmentStatus(b.state, b.result.appointment.id, 'no_show', ctx())).state
    expect(() => setAppointmentStatus(s, b.result.appointment.id, 'booked', cctx())).toThrow('Only a manager')
    s = run(s, setAppointmentStatus(s, b.result.appointment.id, 'booked', mctx())).state
    expect(s.appointments[b.result.appointment.id].status).toBe('booked')
  })
})

describe('calendar', () => {
  test('work windows: shop hours, own hours, days off', () => {
    const s = shopState()
    const cfg = settingsOf(s)
    expect(workWindow(cfg, s.serviceResources.res_asha, nextDay(1))).toEqual({ open: at(nextDay(1), '09:00'), close: at(nextDay(1), '20:00') })
    const part = { ...s.serviceResources.res_asha, openTime: '10:00', closeTime: '14:00', workDays: [new Date(nextDay(1)).getDay()] }
    expect(workWindow(cfg, part, nextDay(1))).toEqual({ open: at(nextDay(1), '10:00'), close: at(nextDay(1), '14:00') })
    expect(workWindow(cfg, part, nextDay(2))).toBeNull()
  })

  test('free slots skip bookings (with clean-up) and the past', () => {
    let s = shopState()
    s = book(s, { start: tomorrowAt('09:00') }).state // 09:00–09:30 (+10)
    const slots = freeSlots(s, 'res_asha', nextDay(1), 30, NOW)
    expect(slots[0]).toBe(tomorrowAt('09:45'))
    expect(slots).not.toContain(tomorrowAt('09:15'))
    expect(slots[slots.length - 1]).toBe(tomorrowAt('19:30'))
    // today: nothing before now
    const today = freeSlots(s, 'res_asha', TODAY, 30, NOW)
    expect(today[0]).toBe(todayAt('10:00'))
    expect(bookingProblem(s, 'res_asha', tomorrowAt('09:00'), tomorrowAt('09:30'))).toContain('already has')
  })

  test('the day board has a column per active column and the week board counts', () => {
    let s = shopState()
    s = book(s, { start: tomorrowAt('10:00') }).state
    s = book(s, { resourceId: 'res_chair', customerId: 'c2', start: tomorrowAt('10:00') }).state
    s = book(s, { customerId: 'c2', start: tomorrowAt('16:00') }).state
    const board = dayBoard(s, nextDay(1) + 3 * 3_600_000)
    expect(board.columns.map((c) => c.resource?.name)).toEqual(['Asha', 'Chair 2'])
    expect(board.columns[0].appointments.map((a) => a.partyName)).toEqual(['Meera', 'Anil'])
    expect(board.total).toBe(3)
    expect(board.start).toBe(at(nextDay(1), '09:00'))
    const week = weekBoard(s, nextDay(1))
    expect(week).toHaveLength(7)
    expect(week[0].day).toBe(weekStart(nextDay(1)))
    const tom = week.find((d) => d.day === nextDay(1))!
    expect(tom.appointments).toHaveLength(3)
    expect(tom.bookedMinutes).toBe(90)
    expect(week[6].day).toBe(addDays(week[0].day, 6))
    const just = weekBoard(s, nextDay(1), 'res_chair').find((d) => d.day === nextDay(1))!
    expect(just.appointments).toHaveLength(1)
    const u = utilisation(s, nextDay(1), nextDay(1) + 86_400_000 - 1)
    expect(u.find((x) => x.resource.id === 'res_asha')).toMatchObject({ appointments: 2, booked: 60 })
  })

  test('day summary adds up the day', () => {
    let s = shopState()
    const a = book(s, { start: tomorrowAt('10:00') })
    s = a.state
    s = book(s, { customerId: 'c2', start: tomorrowAt('12:00'), services: [{ variantId: SVC.spa }] }).state
    s = run(s, setAppointmentStatus(s, a.result.appointment.id, 'cancelled', ctx())).state
    expect(daySummary(s, nextDay(1))).toMatchObject({ total: 1, booked: 1, cancelled: 1, expected: 1200 })
  })
})

describe('reminders', () => {
  test('due inside the lead time, once; the text names the time, the person and the shop note', () => {
    let s = shopState()
    const near = book(s, { start: tomorrowAt('09:30') }) // 23.5 h ahead of 10:00 today
    s = near.state
    const far = book(s, { customerId: 'c2', start: at(nextDay(3), '11:00') })
    s = far.state
    expect(remindersDue(s, NOW).map((a) => a.id)).toEqual([near.result.appointment.id])
    const text = reminderText(s, near.result.appointment, 'Glow Salon')
    expect(text).toContain('Meera')
    expect(text).toContain('Glow Salon')
    expect(text).toContain('9:30 am')
    expect(text).toContain('with Asha')
    s = run(s, markReminded(s, near.result.appointment.id, ctx())).state
    expect(remindersDue(s, NOW)).toHaveLength(0)
    expect(confirmationText(s, far.result.appointment, 'Glow Salon')).toContain('₹500')
  })

  test('slots that passed without anyone arriving are listed to be marked', () => {
    let s = shopState()
    s = book(s, { start: todayAt('10:30') }).state
    expect(overdueBookings(s, NOW)).toHaveLength(0)
    expect(overdueBookings(s, todayAt('11:15'))).toHaveLength(1)
  })
})

describe('convert to bill', () => {
  test('billing an appointment makes a bill for its services and completes it', () => {
    let s = shopState()
    const a = book(s, { services: [{ variantId: SVC.cut }, { variantId: SVC.spa, price: 1000 }] })
    s = a.state
    const id = a.result.appointment.id
    const r = run(s, billAppointment(s, id, [{ mode: 'upi', amount: 1500 }], ctx({ now: todayAt('15:00') })))
    const bill = r.result.bill
    expect(bill.total).toBe(1500)
    expect(bill.items.map((i) => i.name)).toEqual(['Haircut', 'Hair spa'])
    expect(bill.customerId).toBe('c1')
    expect(r.state.appointments[id]).toMatchObject({ status: 'completed', billId: bill.id })
    expect(r.state.variants[SVC.cut].stock).toBe(0) // services never touch stock
    expect(() => billAppointment(r.state, id, [{ mode: 'cash', amount: 1500 }], ctx())).toThrow('already been paid')
  })

  test('a cancelled or missed booking cannot be billed; payments must cover the bill', () => {
    let s = shopState()
    const a = book(s)
    s = a.state
    expect(() => billAppointment(s, a.result.appointment.id, [{ mode: 'cash', amount: 100 }], ctx())).toThrow('less than the bill')
    expect(() => billAppointment(s, a.result.appointment.id, [], ctx())).toThrow('Choose how')
    s = run(s, setAppointmentStatus(s, a.result.appointment.id, 'cancelled', ctx())).state
    expect(() => billAppointment(s, a.result.appointment.id, [{ mode: 'cash', amount: 500 }], ctx())).toThrow('cancelled or missed')
  })
})
