import { divRound } from '../inventory/decimal.js';

/**
 * The payroll calculation: pure, exact, no I/O. Money is in 1/10000 of a rupee (bigint), percentages in 1/10000 of a percent.
 * Everything a run uses (rules in force, year-to-date figures) is passed in, so the same inputs always give the same payslip.
 */
export const RUPEE = 10_000n;
const PERCENT = 1_000_000n; // 100.0000 %
export const roundRupee = (v: bigint): bigint => divRound(v, RUPEE) * RUPEE;
export const ceilRupee = (v: bigint): bigint => (v <= 0n ? 0n : ((v + RUPEE - 1n) / RUPEE) * RUPEE);
const pct = (v: bigint, rate: bigint): bigint => divRound(v * rate, PERCENT);

export interface ComponentIn { code: string; name: string; kind: 'earning' | 'deduction'; calculation: 'fixed' | 'percent_of_basic'; percent: bigint | null; amount: bigint | null; taxable: boolean; pfWage: boolean; esiWage: boolean }
export interface Slab { from: bigint; to: bigint | null; ratePercent?: bigint | null; fixed?: bigint | null }
export interface Rules {
  pfEmployeePct: bigint; pfEmployerPct: bigint; pfCeiling: bigint; esiEmployeePct: bigint; esiEmployerPct: bigint; esiCeiling: bigint;
  ptSlabs: Slab[]; tdsSlabs: Slab[]; stdDeduction: bigint; rebateLimit: bigint; rebateAmount: bigint; cessPct: bigint;
}
export interface CalcInput {
  kind: 'employee' | 'contract_worker'; payBasis: 'monthly' | 'daily' | 'hourly';
  monthDays: number; lopDays: bigint /* hundredths of a day */; unitsWorked: bigint | null /* hundredths */;
  basic: bigint; components: ComponentIn[]; bonus: bigint; otherDeduction: bigint;
  pfApplicable: boolean; esiApplicable: boolean; ptApplicable: boolean; tdsRatePercent: bigint | null;
  rules: Rules; ytdTaxable: bigint; ytdTds: bigint; remainingMonths: number;
}
export interface Line { code: string; name: string; amount: bigint }
export interface Payslip {
  paidDaysFactor: string; basicPaid: bigint; earnings: Line[]; bonus: bigint; gross: bigint; taxableGross: bigint;
  pfWages: bigint; pfEmployee: bigint; pfEmployer: bigint; esiWages: bigint; esiEmployee: bigint; esiEmployer: bigint; professionalTax: bigint; tds: bigint;
  deductions: Line[]; otherDeduction: bigint; totalDeductions: bigint; net: bigint; employerCost: bigint;
  tdsBasis: { projectedAnnual: bigint; taxableIncome: bigint; annualTax: bigint; cess: bigint } | null;
}

export function taxOnSlabs(income: bigint, slabs: Slab[]): bigint {
  let tax = 0n;
  for (const s of [...slabs].sort((a, b) => (a.from < b.from ? -1 : 1))) {
    if (income <= s.from) break;
    const upper = s.to === null || s.to > income ? income : s.to;
    tax += pct(upper - s.from, s.ratePercent ?? 0n);
  }
  return tax;
}
const fixedFor = (amount: bigint, slabs: Slab[]): bigint => slabs.find((s) => amount >= s.from && (s.to === null || amount <= s.to))?.fixed ?? 0n;

export function calculate(i: CalcInput): Payslip {
  const days = BigInt(i.monthDays) * 100n;
  const paidDays = days - i.lopDays;
  if (paidDays < 0n) throw new RangeError('Loss-of-pay days exceed the days in the month');
  const monthly = i.payBasis === 'monthly';
  const factorNum = monthly ? paidDays : 1n;
  const factorDen = monthly ? days : 1n;
  const prorate = (v: bigint): bigint => (monthly ? divRound(v * factorNum, factorDen) : v);
  const basicPaid = monthly ? prorate(i.basic) : i.unitsWorked === null ? 0n : divRound(i.basic * i.unitsWorked, 100n);
  const earnings: Line[] = [{ code: 'BASIC', name: 'Basic', amount: basicPaid }];
  const deductions: Line[] = [];
  let taxable = basicPaid;
  let pfWages = basicPaid;
  let esiWages = basicPaid;
  for (const c of i.components) {
    const base = c.calculation === 'percent_of_basic' ? pct(basicPaid, c.percent ?? 0n) : monthly ? prorate(c.amount ?? 0n) : (c.amount ?? 0n);
    if (c.kind === 'deduction') { deductions.push({ code: c.code, name: c.name, amount: base }); continue; }
    earnings.push({ code: c.code, name: c.name, amount: base });
    if (c.taxable) taxable += base;
    if (c.pfWage) pfWages += base;
    if (c.esiWage) esiWages += base;
  }
  const earned = earnings.reduce((a, l) => a + l.amount, 0n);
  const gross = earned + i.bonus;
  const taxableGross = taxable + i.bonus;
  const r = i.rules;

  const pfBase = r.pfCeiling > 0n && pfWages > r.pfCeiling ? r.pfCeiling : pfWages;
  const pfEmployee = i.pfApplicable ? roundRupee(pct(pfBase, r.pfEmployeePct)) : 0n;
  const pfEmployer = i.pfApplicable ? roundRupee(pct(pfBase, r.pfEmployerPct)) : 0n;
  const esiOn = i.esiApplicable && esiWages <= r.esiCeiling;
  const esiEmployee = esiOn ? ceilRupee(pct(esiWages, r.esiEmployeePct)) : 0n;
  const esiEmployer = esiOn ? ceilRupee(pct(esiWages, r.esiEmployerPct)) : 0n;
  const professionalTax = i.ptApplicable ? fixedFor(gross, r.ptSlabs) : 0n;

  let tds = 0n;
  let tdsBasis: Payslip['tdsBasis'] = null;
  if (i.kind === 'contract_worker') tds = i.tdsRatePercent ? roundRupee(pct(gross, i.tdsRatePercent)) : 0n;
  else if (r.tdsSlabs.length > 0) {
    const projected = i.ytdTaxable + taxableGross * BigInt(i.remainingMonths);
    const income = projected > r.stdDeduction ? projected - r.stdDeduction : 0n;
    let tax = taxOnSlabs(income, r.tdsSlabs);
    if (r.rebateLimit > 0n && income <= r.rebateLimit) tax = tax > r.rebateAmount ? tax - r.rebateAmount : 0n;
    const cess = pct(tax, r.cessPct);
    const annual = tax + cess;
    const remaining = annual > i.ytdTds ? annual - i.ytdTds : 0n;
    tds = roundRupee(divRound(remaining, BigInt(Math.max(1, i.remainingMonths))));
    tdsBasis = { projectedAnnual: projected, taxableIncome: income, annualTax: annual, cess };
  }
  const fixedDeductions = deductions.reduce((a, l) => a + l.amount, 0n);
  const totalDeductions = pfEmployee + esiEmployee + professionalTax + tds + fixedDeductions + i.otherDeduction;
  return {
    paidDaysFactor: monthly ? `${paidDays}/${days}` : '1', basicPaid, earnings, bonus: i.bonus, gross, taxableGross, pfWages: pfBase, pfEmployee, pfEmployer, esiWages: esiOn ? esiWages : 0n, esiEmployee, esiEmployer,
    professionalTax, tds, deductions, otherDeduction: i.otherDeduction, totalDeductions, net: gross - totalDeductions, employerCost: gross + pfEmployer + esiEmployer, tdsBasis,
  };
}
