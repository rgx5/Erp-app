import { describe, expect, it } from 'vitest';
import { addMonths, schedule, toPaise } from './loans.logic.js';

describe('loan schedules', () => {
  it('a reducing-balance loan of 1,00,000 at 12% over 12 months has the usual EMI and repays exactly the principal', () => {
    const s = schedule({ principal: 100000, annualRatePct: 12, months: 12, method: 'reducing', firstDue: '2026-12-05' });
    expect(s).toHaveLength(12);
    expect(s[0]!.emi).toBe(888488);                      // ₹8,884.88
    expect(s[0]!.interest).toBe(100000);                 // 1% of ₹1,00,000
    expect(s.reduce((t, r) => t + r.principal, 0)).toBe(toPaise(100000));
    expect(s.every((r) => r.emi === r.principal + r.interest)).toBe(true);
    expect(s[11]!.dueDate).toBe('2027-11-05');
    expect(Math.abs(s[11]!.emi - s[0]!.emi)).toBeLessThan(20); // the last instalment differs only by rounding
  });
  it('a loan with no interest is the principal split evenly', () => {
    const s = schedule({ principal: 1200, annualRatePct: 0, months: 12, method: 'reducing', firstDue: '2026-12-01' });
    expect(s.map((r) => r.emi)).toEqual(Array(12).fill(10000));
    expect(s.every((r) => r.interest === 0)).toBe(true);
  });
  it('a flat-rate loan charges interest on the original amount for the whole term, spread evenly', () => {
    const s = schedule({ principal: 120000, annualRatePct: 10, months: 12, method: 'flat', firstDue: '2026-12-01' });
    expect(s.reduce((t, r) => t + r.interest, 0)).toBe(1200000);   // ₹12,000
    expect(s.reduce((t, r) => t + r.principal, 0)).toBe(12000000);
    expect(s[0]!.emi).toBe(1100000);                               // ₹11,000 a month
  });
  it('keeps due dates on the same day, clamped to short months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-12-15', 12)).toBe('2027-12-15');
  });
});
