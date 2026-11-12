import { describe, expect, it } from 'vitest';
import { financialYearOf, formatNumber } from './numbering.service.js';

describe('financialYearOf (statutory April-March year)', () => {
  it('rolls over on 1 April', () => {
    expect(financialYearOf(new Date('2025-03-31T23:59:59Z'))).toBe('2024-25');
    expect(financialYearOf(new Date('2025-04-01T00:00:00Z'))).toBe('2025-26');
    expect(financialYearOf(new Date('2099-12-31T00:00:00Z'))).toBe('2099-00');
  });
});

describe('formatNumber', () => {
  const base = { prefix: 'INV', separator: '/', includeFinancialYear: true, padding: 5, financialYear: '2024-25' };
  it('builds prefix, financial year and padded value', () => {
    expect(formatNumber(base, 1)).toBe('INV/2425/00001');
    expect(formatNumber({ ...base, separator: '-' }, 123)).toBe('INV-2425-00123');
    expect(formatNumber({ ...base, includeFinancialYear: false }, 7)).toBe('INV/00007');
    expect(formatNumber({ ...base, prefix: '', includeFinancialYear: false, separator: '' }, 42)).toBe('00042');
  });
  it('never truncates a value that outgrows its padding', () => {
    expect(formatNumber(base, 1234567)).toBe('INV/2425/1234567');
  });
});
