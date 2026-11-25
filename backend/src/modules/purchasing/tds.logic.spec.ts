import { describe, expect, it } from 'vitest';
import { computeTds, financialYearOf } from './tds.logic.js';

const base = { sectionRate: '10', singleLimit: '50000', annualLimit: '50000', paidBeforeInYear: '0', hasPan: true };
describe('TDS arithmetic', () => {
  it('takes nothing while payments stay under the limit, and the rate once they pass it', () => {
    expect(computeTds({ ...base, base: '40000' })).toMatchObject({ applies: false, amount: '0.00' });
    expect(computeTds({ ...base, base: '60000' })).toMatchObject({ applies: true, rate: 10, amount: '6000.00' });
    expect(computeTds({ ...base, base: '30000', paidBeforeInYear: '30000' })).toMatchObject({ applies: true, amount: '3000.00' }); // the year's total passes 50,000
  });
  it('catches up the year when only an annual limit applies (rent, interest, goods)', () => {
    const rent = { sectionRate: '10', singleLimit: '0', annualLimit: '600000', hasPan: true };
    expect(computeTds({ ...rent, base: '50000', paidBeforeInYear: '500000' })).toMatchObject({ applies: false });
    expect(computeTds({ ...rent, base: '150000', paidBeforeInYear: '500000' })).toMatchObject({ applies: true, amount: '65000.00' }); // all 650,000 is liable
  });
  it('charges at least 20% without a PAN, and rounds to the rupee', () => {
    expect(computeTds({ ...base, base: '100000', hasPan: false })).toMatchObject({ rate: 20, amount: '20000.00' });
    expect(computeTds({ sectionRate: '2', singleLimit: '0', annualLimit: '1', base: '12345.67', paidBeforeInYear: '0', hasPan: true }).amount).toBe('247.00');
  });
  it('finds the financial year', () => { expect(financialYearOf('2026-03-31')).toEqual({ from: '2025-04-01', to: '2026-03-31' }); expect(financialYearOf('2026-04-01').from).toBe('2026-04-01'); });
});
