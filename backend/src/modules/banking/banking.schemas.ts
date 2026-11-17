import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const signed = z.string().regex(/^-?[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A decimal with at most 4 places, as a string (negative for money out)');
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };

export const createBankAccountSchema = z.strictObject({
  companyId: z.uuid(),
  /** The ledger account (an ordinary asset account) that holds this bank account's balance. */
  accountId: z.uuid(),
  name: text(100),
  bankName: text(100).optional(),
  /** A reference people recognise, such as the last four digits. Never the full number. */
  accountRef: text(40).optional(),
  clearedThrough: isoDate.optional(),
});
export const updateBankAccountSchema = z
  .strictObject({ name: text(100).optional(), bankName: text(100).nullable().optional(), accountRef: text(40).nullable().optional(), clearedThrough: isoDate.nullable().optional(), status: z.enum(['active', 'inactive']).optional() })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export const listBankAccountsQuery = z.object({ companyId: z.uuid() });

export const importStatementSchema = z
  .strictObject({
    periodFrom: isoDate,
    periodTo: isoDate,
    openingBalance: signed,
    closingBalance: signed,
    lines: z.array(z.strictObject({ date: isoDate, description: text(500), reference: text(100).optional(), amount: signed, balance: signed.optional() })).min(1).max(5000),
  })
  .refine((v) => v.periodTo >= v.periodFrom, { path: ['periodTo'], message: 'Must not be before the start' });
export const voidStatementSchema = z.strictObject({ reason: text(300) });
export const listStatementsQuery = z.object({ ...page });
export const listLinesQuery = z.object({
  ...page,
  statementId: z.uuid().optional(),
  status: z.enum(['unmatched', 'matched', 'ignored']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const candidatesQuery = z.object({ days: z.coerce.number().int().min(0).max(60).default(7), scope: z.enum(['exact', 'any']).default('exact') });
export const matchSchema = z.strictObject({ journalLineIds: z.array(z.uuid()).min(1).max(50) });
export const unmatchSchema = z.strictObject({ reason: text(300) });
export const ignoreSchema = z.strictObject({ reason: text(300) });
export const autoMatchSchema = z.strictObject({ statementId: z.uuid().optional(), days: z.number().int().min(0).max(30).default(3) });
export const bookSchema = z.strictObject({
  /** The other side of the entry: for example bank charges, interest received. An ordinary (non-control) account. */
  accountId: z.uuid(),
  description: text(300).optional(),
});
export const reconciliationQuery = z.object({ asOf: isoDate });

export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;
export type UpdateBankAccountInput = z.infer<typeof updateBankAccountSchema>;
export type ImportStatementInput = z.infer<typeof importStatementSchema>;
export type ListLinesQuery = z.infer<typeof listLinesQuery> & { bankAccountId: string };
