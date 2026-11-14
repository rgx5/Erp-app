import { describe, expect, it } from 'vitest';
import { calculate, taxOnSlabs, type CalcInput, type Rules } from './payroll-calc.js';

const R = 10_000n; // one rupee
const pctU = (p: number): bigint => BigInt(Math.round(p * 10_000));
const NEW_SLABS = [
  { from: 0n, to: 400_000n * R, ratePercent: 0n }, { from: 400_000n * R, to: 800_000n * R, ratePercent: pctU(5) }, { from: 800_000n * R, to: 1_200_000n * R, ratePercent: pctU(10) },
  { from: 1_200_000n * R, to: 1_600_000n * R, ratePercent: pctU(15) }, { from: 1_600_000n * R, to: 2_000_000n * R, ratePercent: pctU(20) }, { from: 2_000_000n * R, to: 2_400_000n * R, ratePercent: pctU(25) }, { from: 2_400_000n * R, to: null, ratePercent: pctU(30) },
];
const rules: Rules = {
  pfEmployeePct: pctU(12), pfEmployerPct: pctU(12), pfCeiling: 15_000n * R, esiEmployeePct: pctU(0.75), esiEmployerPct: pctU(3.25), esiCeiling: 21_000n * R,
  ptSlabs: [{ from: 0n, to: 7_500n * R, fixed: 0n }, { from: 7_500n * R + 1n, to: 10_000n * R, fixed: 175n * R }, { from: 10_000n * R + 1n, to: null, fixed: 200n * R }],
  tdsSlabs: NEW_SLABS, stdDeduction: 75_000n * R, rebateLimit: 1_200_000n * R, rebateAmount: 60_000n * R, cessPct: pctU(4),
};
const base: CalcInput = {
  kind: 'employee', payBasis: 'monthly', monthDays: 30, lopDays: 0n, unitsWorked: null, basic: 30_000n * R, bonus: 0n, otherDeduction: 0n,
  components: [
    { code: 'HRA', name: 'House rent', kind: 'earning', calculation: 'percent_of_basic', percent: pctU(40), amount: null, taxable: true, pfWage: false, esiWage: true },
    { code: 'SPL', name: 'Special', kind: 'earning', calculation: 'fixed', percent: null, amount: 10_000n * R, taxable: true, pfWage: false, esiWage: true },
  ],
  pfApplicable: true, esiApplicable: true, ptApplicable: true, tdsRatePercent: null, rules, ytdTaxable: 0n, ytdTds: 0n, remainingMonths: 12,
};

describe('income tax slabs', () => {
  it('taxes each slab at its rate', () => {
    expect(taxOnSlabs(300_000n * R, NEW_SLABS)).toBe(0n);
    expect(taxOnSlabs(549_000n * R, NEW_SLABS)).toBe(7_450n * R);
    expect(taxOnSlabs(1_725_000n * R, NEW_SLABS)).toBe(145_000n * R);
  });
});

describe('payslip', () => {
  it('computes earnings, PF on the ceiling, PT, and no tax under the rebate', () => {
    const p = calculate(base);
    expect(p.gross).toBe(52_000n * R); // 30,000 + 40% HRA + 10,000
    expect(p.pfWages).toBe(15_000n * R); // PF wages are basic, capped at the ceiling
    expect(p.pfEmployee).toBe(1_800n * R);
    expect(p.pfEmployer).toBe(1_800n * R);
    expect(p.esiEmployee).toBe(0n); // gross is above the ESI ceiling
    expect(p.professionalTax).toBe(200n * R);
    expect(p.tds).toBe(0n); // 52,000 x 12 less standard deduction is under the rebate limit
    expect(p.net).toBe((52_000n - 1_800n - 200n) * R);
    expect(p.employerCost).toBe((52_000n + 1_800n) * R);
  });
  it('prorates a monthly salary for loss-of-pay days', () => {
    const p = calculate({ ...base, lopDays: 300n, rules: { ...rules, tdsSlabs: [] } }); // 3 of 30 days
    expect(p.basicPaid).toBe(27_000n * R);
    expect(p.earnings.find((l) => l.code === 'HRA')?.amount).toBe(10_800n * R); // 40% of the paid basic
    expect(p.earnings.find((l) => l.code === 'SPL')?.amount).toBe(9_000n * R);
    expect(p.gross).toBe(46_800n * R);
  });
  it('charges ESI, rounded up, below the ceiling, and none above it', () => {
    const lowPaid = calculate({ ...base, basic: 12_000n * R, components: [], rules: { ...rules, tdsSlabs: [] } });
    expect(lowPaid.esiEmployee).toBe(90n * R); // 0.75% of 12,000
    expect(lowPaid.esiEmployer).toBe(390n * R); // 3.25%
    expect(lowPaid.pfEmployee).toBe(1_440n * R); // under the PF ceiling: 12% of 12,000
    const odd = calculate({ ...base, basic: 10_001n * R, components: [], rules: { ...rules, tdsSlabs: [] } });
    expect(odd.esiEmployee).toBe(76n * R); // 75.0075 rounds up
  });
  it('deducts income tax spread over the months left, net of what was deducted', () => {
    const rich: CalcInput = { ...base, basic: 100_000n * R, components: [{ code: 'SPL', name: 'Special', kind: 'earning', calculation: 'fixed', percent: null, amount: 50_000n * R, taxable: true, pfWage: false, esiWage: false }] };
    const p = calculate(rich);
    expect(p.gross).toBe(150_000n * R);
    expect(p.tdsBasis).toMatchObject({ projectedAnnual: 1_800_000n * R, taxableIncome: 1_725_000n * R, annualTax: 150_800n * R }); // 145,000 + 4% cess
    expect(p.tds).toBe(12_567n * R); // 150,800 / 12, to the rupee
    // after 6 months at this pay, with 75,400 already deducted, the remaining 75,400 spreads over 6
    const later = calculate({ ...rich, ytdTaxable: 900_000n * R, ytdTds: 75_400n * R, remainingMonths: 6 });
    expect(later.tds).toBe(12_567n * R);
    // already over-deducted: nothing more
    expect(calculate({ ...rich, ytdTds: 200_000n * R }).tds).toBe(0n);
  });
  it('pays a contract worker by units at a flat TDS rate, with no PF/ESI unless set', () => {
    const p = calculate({ ...base, kind: 'contract_worker', payBasis: 'daily', basic: 800n * R, unitsWorked: 2_250n, components: [], pfApplicable: false, esiApplicable: false, ptApplicable: false, tdsRatePercent: pctU(1) });
    expect(p.gross).toBe(18_000n * R); // 22.5 days at 800
    expect(p.tds).toBe(180n * R);
    expect(p.pfEmployee + p.esiEmployee + p.professionalTax).toBe(0n);
    expect(p.net).toBe(17_820n * R);
  });
  it('adds bonus (taxable, not PF wages) and takes other deductions and fixed deductions', () => {
    const p = calculate({ ...base, bonus: 5_000n * R, otherDeduction: 1_000n * R, components: [...base.components, { code: 'LOAN', name: 'Loan EMI', kind: 'deduction', calculation: 'fixed', percent: null, amount: 2_000n * R, taxable: false, pfWage: false, esiWage: false }] });
    expect(p.gross).toBe(57_000n * R);
    expect(p.pfWages).toBe(15_000n * R);
    expect(p.deductions).toEqual([{ code: 'LOAN', name: 'Loan EMI', amount: 2_000n * R }]);
    expect(p.net).toBe((57_000n - 1_800n - 200n - 2_000n - 1_000n) * R);
  });
  it('refuses more loss-of-pay days than the month has', () => {
    expect(() => calculate({ ...base, lopDays: 3_100n })).toThrow();
  });
});
