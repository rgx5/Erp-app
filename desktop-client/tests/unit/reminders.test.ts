import { describe, expect, it } from 'vitest'
import { oldestOverdue, overdueOf, reminderText } from '@/features/sales/reminderText'

describe('payment reminder text', () => {
  const b = { days1to30: '0', days31to60: '1500.50', days61to90: '0', over90: '0' }
  it('fills in the customer, amount, age and UPI line', () => {
    const t = reminderText('Hi {name}, {shop}: {amount} overdue ({oldest}).{upi}', { name: 'Asha', shop: 'Sunrise', amount: '₹1,500.50', oldest: oldestOverdue(b), upiId: 'sunrise@okaxis' })
    expect(t).toBe('Hi Asha, Sunrise: ₹1,500.50 overdue (31 to 60 days). You can pay by UPI to sunrise@okaxis.')
    expect(reminderText('{upi}', { name: 'a', shop: 'b', amount: 'c', oldest: 'd' })).toBe('')
  })
  it('adds the overdue buckets and names the oldest', () => {
    expect(overdueOf(b)).toBeCloseTo(1500.5)
    expect(oldestOverdue({ ...b, over90: '10' })).toBe('over 90 days')
    expect(oldestOverdue({ days1to30: '5', days31to60: '0', days61to90: '0', over90: '0' })).toBe('up to 30 days')
  })
})
