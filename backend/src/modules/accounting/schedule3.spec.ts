import { describe, expect, it } from 'vitest';
import { ALL_LINES, DEFAULT_MAPPING, lineByCode, profitLoss } from './schedule3.js';

describe('schedule III structure', () => {
  it('has unique line codes and every default mapping points at a real line', () => {
    expect(new Set(ALL_LINES.map((l) => l.code)).size).toBe(ALL_LINES.length);
    for (const line of Object.values(DEFAULT_MAPPING)) expect(lineByCode.has(line), line).toBe(true);
  });
  it('adds revenue, subtracts expenses, then tax', () => {
    const v: Record<string, bigint> = { 'PL.REVENUE': 1_000_000n, 'PL.OTHER_INCOME': 50_000n, 'PL.MATERIALS': 400_000n, 'PL.EMPLOYEE': 100_000n, 'PL.OTHER_EXPENSES': 50_000n, 'PL.TAX': 120_000n };
    expect(profitLoss((c) => v[c] ?? 0n)).toEqual({ revenue: 1_000_000n, otherIncome: 50_000n, totalRevenue: 1_050_000n, totalExpenses: 550_000n, profitBeforeTax: 500_000n, tax: 120_000n, profit: 380_000n });
  });
});
