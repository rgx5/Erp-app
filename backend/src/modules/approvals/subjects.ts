import type { z } from 'zod';
import { postJournalSchema } from '../accounting/accounting.schemas.js';
import { createPaymentSchema, createPurchaseOrderSchema } from '../purchasing/purchasing.schemas.js';
import { divRound } from '../inventory/decimal.js';
import { fromUnits, toUnits } from '../accounting/money.js';
import type { DOCUMENT_TYPES } from './approvals.schemas.js';

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** What each approvable command is: its real input schema, the permission the requester needs, and how its amount is measured. */
interface Subject<S extends z.ZodType> {
  label: string;
  permission: string;
  schema: S;
  companyId: (input: z.infer<S>) => string;
  /** The value the policy threshold is compared with (a 4-decimal string). */
  amount: (input: z.infer<S>) => string;
  summary: (input: z.infer<S>) => string;
}

const subject = <S extends z.ZodType>(s: Subject<S>): Subject<S> => s;

const PO = subject({
  label: 'Purchase order',
  permission: 'purchasing:post',
  schema: createPurchaseOrderSchema,
  companyId: (i) => i.companyId,
  /** Order value before tax: quantity x price, less line discount. */
  amount: (i) => {
    let total = 0n;
    for (const l of i.lines) {
      const [whole = '0', frac = ''] = l.quantity.split('.');
      const qtyUnits = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
      const gross = divRound(qtyUnits * toUnits(l.unitPrice), 1_000_000n);
      const pct = toUnits(l.discountPercent); // 100% = 1_000_000 units
      total += divRound(gross * (1_000_000n - pct), 1_000_000n);
    }
    return fromUnits(total);
  },
  summary: (i) => `Purchase order dated ${i.orderDate}, ${i.lines.length} line(s)`,
});
const PAYMENT = subject({
  label: 'Supplier payment',
  permission: 'payables:post',
  schema: createPaymentSchema,
  companyId: (i) => i.companyId,
  amount: (i) => fromUnits(toUnits(i.amount)),
  summary: (i) => `Payment of ${i.amount} dated ${i.paymentDate}`,
});
const JOURNAL = subject({
  label: 'Manual journal',
  permission: 'accounting:post',
  schema: postJournalSchema,
  companyId: (i) => i.companyId,
  /** The total of the debits (equal to the credits for any valid journal). */
  amount: (i) => fromUnits(i.lines.reduce((a, l) => a + (l.debit ? toUnits(l.debit) : 0n), 0n)),
  summary: (i) => `Journal dated ${i.postingDate}: ${i.description}`,
});

export const SUBJECTS = { purchase_order: PO, payment: PAYMENT, journal: JOURNAL } as const;

/** Stable JSON (sorted keys) so the same payload always has the same hash. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
