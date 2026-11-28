/**
 * Repayment schedules. Amounts are in paise (hundredths of a rupee) so every instalment adds up exactly; the last instalment absorbs the rounding.
 * `reducing`: interest each month on what is still owed (the usual bank loan). `flat`: interest on the original amount for the whole term, spread evenly.
 */
export interface ScheduleInput { principal: number; annualRatePct: number; months: number; method: 'reducing' | 'flat'; firstDue: string }
export interface Instalment { no: number; dueDate: string; principal: number; interest: number; emi: number }

export const toPaise = (rupees: string | number): number => Math.round(Number(rupees) * 100);
export const toRupees = (paise: number): string => (paise / 100).toFixed(2);

/** The date `n` months after `iso`, kept to the same day where the month allows (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const total = (m - 1) + n; const ny = y + Math.floor(total / 12); const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function schedule(i: ScheduleInput): Instalment[] {
  const P = toPaise(i.principal); const n = i.months; const out: Instalment[] = [];
  if (i.method === 'flat') {
    const totalInterest = Math.round((P * i.annualRatePct * n) / 1200);
    let pLeft = P; let iLeft = totalInterest;
    for (let k = 1; k <= n; k++) {
      const last = k === n;
      const principal = last ? pLeft : Math.floor(P / n); const interest = last ? iLeft : Math.floor(totalInterest / n);
      pLeft -= principal; iLeft -= interest;
      out.push({ no: k, dueDate: addMonths(i.firstDue, k - 1), principal, interest, emi: principal + interest });
    }
    return out;
  }
  const r = i.annualRatePct / 1200;
  const emi = r === 0 ? Math.round(P / n) : Math.round((P * r * (1 + r) ** n) / ((1 + r) ** n - 1));
  let bal = P;
  for (let k = 1; k <= n; k++) {
    const interest = Math.round(bal * r);
    const last = k === n;
    const principal = last ? bal : Math.min(bal, emi - interest);
    bal -= principal;
    out.push({ no: k, dueDate: addMonths(i.firstDue, k - 1), principal, interest, emi: principal + interest });
  }
  return out;
}

/** The regular instalment (the first one; the last may differ by a few paise). */
export const emiOf = (rows: Instalment[]): number => rows[0]?.emi ?? 0;
