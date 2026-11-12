import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const amount = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A non-negative decimal with at most 4 places, as a string');
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };
const NOTHING = 'Send at least one field to change';
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export const CONTROL_KINDS = ['receivable', 'payable', 'inventory', 'work_in_progress', 'tax'] as const;

export const createAccountSchema = z
  .strictObject({
    companyId: z.uuid(),
    code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/, 'Letters, digits and . _ - (max 20)'),
    name: text(200),
    type: z.enum(ACCOUNT_TYPES),
    parentId: z.uuid().optional(),
    isGroup: z.boolean().default(false),
    controlKind: z.enum(CONTROL_KINDS).optional(),
  })
  .refine((v) => !(v.isGroup && v.controlKind), { path: ['controlKind'], message: 'A group account cannot be a control account' });
export const updateAccountSchema = z.strictObject({ code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/).optional(), name: text(200).optional(), status: z.enum(['active', 'inactive']).optional() }).refine((v) => Object.keys(v).length > 0, NOTHING);
export const listAccountsQuery = z.object({ ...page, companyId: z.uuid(), type: z.enum(ACCOUNT_TYPES).optional(), q: z.string().trim().min(1).max(60).optional() });
export const applyTemplateSchema = z.strictObject({ template: z.enum(['manufacturing_india']) });

export const createFiscalYearSchema = z
  .strictObject({ companyId: z.uuid(), startDate: isoDate, label: z.string().regex(/^[0-9]{4}(-[0-9]{2})?$/, 'e.g. 2025-26').optional() })
  .refine((v) => v.startDate.endsWith('-01'), { path: ['startDate'], message: 'A fiscal year starts on the 1st of a month' });
export const companyQuery = z.object({ companyId: z.uuid() });

const lineSchema = z
  .strictObject({ accountId: z.uuid(), debit: amount.optional(), credit: amount.optional(), description: text(300).optional(), businessLocationId: z.uuid().optional(), partyId: z.uuid().optional() })
  .refine((l) => (l.debit !== undefined) !== (l.credit !== undefined), { message: 'Give exactly one of debit or credit' })
  .refine((l) => Number(l.debit ?? l.credit) > 0, { message: 'The amount must be greater than zero' });
export const postJournalSchema = z.strictObject({
  companyId: z.uuid(),
  postingDate: isoDate,
  journalType: z.enum(['general', 'opening', 'adjustment']).default('general'),
  description: text(500),
  lines: z.array(lineSchema).min(2).max(500),
});
export const reverseSchema = z.strictObject({ postingDate: isoDate, reason: text(300) });
export const listEntriesQuery = z.object({
  ...page,
  companyId: z.uuid(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  journalType: z.enum(['general', 'opening', 'adjustment', 'reversal', 'system']).optional(),
  sourceType: z.string().max(40).optional(),
  accountId: z.uuid().optional(),
});
export const trialBalanceQuery = z.object({ companyId: z.uuid(), from: isoDate, to: isoDate }).refine((v) => v.to >= v.from, { path: ['to'], message: 'Must not be before from' });
export const ledgerQuery = z
  .object({ companyId: z.uuid(), accountId: z.uuid(), from: isoDate, to: isoDate, limit: z.coerce.number().int().min(1).max(2000).default(500) })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'Must not be before from' });

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type ListAccountsQuery = z.infer<typeof listAccountsQuery>;
export type CreateFiscalYearInput = z.infer<typeof createFiscalYearSchema>;
export type PostJournalInput = z.infer<typeof postJournalSchema>;
export type ListEntriesQuery = z.infer<typeof listEntriesQuery>;
