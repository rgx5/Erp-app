import type { DayCloseFigures } from '../analytics'
import { dayCloseHtml, dayCloseText, varianceKind, varianceLabel, type DayCloseDoc } from '../dayclose-report'
import type { DaySession } from '../types'

const figures: DayCloseFigures = { bills: 12, totalSales: 18450.5, cashIn: 9200, digital: 9250.5, cashExpenses: 450, opening: 2000, expected: 10750 }

const opened = new Date('2026-10-19T09:30:00').getTime()
const closedAt = new Date('2026-10-19T21:05:00').getTime()

const store = { name: 'Sharma & Sons <Traders>', address: '12 MG Road', city: 'Pune', phone: '9876500000', gstin: '27AAAAA0000A1Z5' }

const closedSession: DaySession = { id: 's1', openedAt: opened, openedBy: 'u', openingCash: 2000, closedAt, closedBy: 'u', countedCash: 10700, expectedCash: 10750, variance: -50 }
const openSession: DaySession = { id: 's2', openedAt: opened, openedBy: 'u', openingCash: 2000 }

const doc = (session: DaySession, over: Partial<DayCloseDoc> = {}): DayCloseDoc => ({ store, session, figures, openedBy: 'Asha', closedBy: 'Ravi', ...over })

describe('day close variance', () => {
  test('short, over, balanced and not-counted read differently', () => {
    expect(varianceKind(-50)).toBe('short')
    expect(varianceKind(20)).toBe('over')
    expect(varianceKind(0)).toBe('balanced')
    expect(varianceKind(0.001)).toBe('balanced')
    expect(varianceKind(undefined)).toBe('none')
    expect(varianceLabel(-50)).toBe('Short by ₹50.00')
    expect(varianceLabel(20.5)).toBe('Over by ₹20.50')
    expect(varianceLabel(0)).toBe('Cash matches')
    expect(varianceLabel(undefined)).toBe('Not counted yet')
  })
})

describe('day close report', () => {
  test('html shows the drawer arithmetic and the counted figure', () => {
    const h = dayCloseHtml(doc(closedSession))
    expect(h).toContain('Z-REPORT')
    expect(h).toContain('Opening cash')
    expect(h).toContain('₹2,000.00')
    expect(h).toContain('Expected in drawer')
    expect(h).toContain('₹10,750.00')
    expect(h).toContain('Counted')
    expect(h).toContain('₹10,700.00')
    expect(h).toContain('Short by ₹50.00')
    expect(h).toContain('Ravi')
  })

  test('html escapes the business name', () => {
    const h = dayCloseHtml(doc(closedSession))
    expect(h).toContain('Sharma &amp; Sons &lt;Traders&gt;')
    expect(h).not.toContain('<Traders>')
  })

  test('an open day is an X-report with no counted figure', () => {
    const h = dayCloseHtml(doc(openSession))
    expect(h).toContain('X-REPORT')
    expect(h).toContain('Cash not counted yet')
    expect(h).not.toContain('Closed')
  })

  test('a closed day uses the frozen expected figure, not a recomputed one', () => {
    const h = dayCloseHtml(doc({ ...closedSession, expectedCash: 10000, variance: 700 }))
    expect(h).toContain('₹10,000.00')
    expect(h).toContain('Over by ₹700.00')
  })

  test('text is ready for WhatsApp', () => {
    const t = dayCloseText(doc(closedSession))
    expect(t).toContain('*Sharma & Sons <Traders>* — Day close')
    expect(t).toContain('Sales: ₹18,450.50 (12 bills)')
    expect(t).toContain('Expected in drawer: ₹10,750.00')
    expect(t).toContain('Counted: ₹10,700.00')
    expect(t).toContain('Short by ₹50.00')
    expect(dayCloseText(doc(openSession))).toContain('Day so far')
    expect(dayCloseText(doc(openSession))).not.toContain('Counted')
  })

  test('a single bill is not "1 bills"', () => {
    expect(dayCloseText({ ...doc(openSession), figures: { ...figures, bills: 1 } })).toContain('(1 bill)')
  })
})
