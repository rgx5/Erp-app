/** The arithmetic of tax deducted at source. Money is handled in paise as integers. */
export interface Section { code: string; description: string; rate: string; singleLimit: string; annualLimit: string }
export const DEFAULT_SECTIONS: Section[] = [
  { code: '194C-I', description: 'Contractor: individual or HUF', rate: '1', singleLimit: '30000', annualLimit: '100000' },
  { code: '194C-O', description: 'Contractor: company or firm', rate: '2', singleLimit: '30000', annualLimit: '100000' },
  { code: '194J-P', description: 'Professional or director fees', rate: '10', singleLimit: '50000', annualLimit: '50000' },
  { code: '194J-T', description: 'Technical services, call centre, royalty (some)', rate: '2', singleLimit: '50000', annualLimit: '50000' },
  { code: '194H', description: 'Commission or brokerage', rate: '2', singleLimit: '20000', annualLimit: '20000' },
  { code: '194I-A', description: 'Rent: plant, machinery or equipment', rate: '2', singleLimit: '50000', annualLimit: '600000' },
  { code: '194I-B', description: 'Rent: land, building or furniture', rate: '10', singleLimit: '50000', annualLimit: '600000' },
  { code: '194A', description: 'Interest other than on securities', rate: '10', singleLimit: '0', annualLimit: '10000' },
  { code: '194Q', description: 'Purchase of goods above 50 lakh in the year', rate: '0.1', singleLimit: '0', annualLimit: '5000000' },
];
export const NO_PAN_RATE = 20;
const paise = (v: string | number): bigint => BigInt(Math.round(Number(v) * 100));
const rupees = (p: bigint): string => `${p / 100n}.${String(p % 100n < 0n ? -(p % 100n) : p % 100n).padStart(2, '0')}`;
/** The financial year (April to March) a date falls in, as its first and last day. */
export function financialYearOf(date: string): { from: string; to: string } {
  const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); const s = m >= 4 ? y : y - 1;
  return { from: `${s}-04-01`, to: `${s + 1}-03-31` };
}

export interface TdsInput { base: string; sectionRate: string; singleLimit: string; annualLimit: string; paidBeforeInYear: string; hasPan: boolean }
export interface TdsResult { applies: boolean; rate: number; amount: string; reason: string }
/**
 * Whether TDS is due on this payment and how much. Below the single-payment limit and while the year's total stays within the annual limit, none is due.
 * Without a PAN the rate is at least 20%. The amount is rounded to the nearest rupee, as the rules ask.
 */
export function computeTds(i: TdsInput): TdsResult {
  const base = paise(i.base); const before = paise(i.paidBeforeInYear);
  const rate = i.hasPan ? Number(i.sectionRate) : Math.max(Number(i.sectionRate), NO_PAN_RATE);
  const single = paise(i.singleLimit); const annual = paise(i.annualLimit);
  const under = (single > 0n || annual > 0n) && (single === 0n || base <= single) && before + base <= (annual > 0n ? annual : single);
  if (under) return { applies: false, rate, amount: '0.00', reason: 'The payments to this supplier are still under the limit for this section, so nothing is deducted yet.' };
  // once the annual limit is crossed, the whole year's payments are liable, so the part already paid without deduction is caught up in this payment
  const liable = annual > 0n && before <= annual && before + base > annual && single === 0n ? before + base : base;
  const exact = (liable * BigInt(Math.round(rate * 10_000))) / 1_000_000n; // paise
  const tds = ((exact + 50n) / 100n) * 100n; // to the nearest rupee
  return { applies: tds > 0n, rate, amount: rupees(tds), reason: !i.hasPan ? 'No PAN is on record for this supplier, so the higher rate of at least 20% applies.' : '' };
}
