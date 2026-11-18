import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const positive = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A positive decimal with at most 4 places, as a string').refine((v) => Number(v) > 0, 'Must be greater than zero');
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };

export const createExpenseCategorySchema = z.strictObject({ companyId: z.uuid(), code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,29}$/, 'Letters, digits and . _ / - (max 30)'), name: text(100), expenseAccountId: z.uuid() });
export const updateExpenseCategorySchema = z.strictObject({ name: text(100).optional(), expenseAccountId: z.uuid().optional(), status: z.enum(['active', 'inactive']).optional() }).refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');
export const listExpenseCategoriesQuery = z.object({ companyId: z.uuid(), status: z.enum(['active', 'inactive']).optional() });
export const createExpenseSchema = z.strictObject({ companyId: z.uuid(), voucherDate: isoDate, categoryId: z.uuid(), amount: positive, paidFromAccountId: z.uuid(), payee: text(150).optional(), note: text(300).optional() });
export const cancelExpenseSchema = z.strictObject({ date: isoDate, reason: text(300) });
export const listExpensesQuery = z.object({ ...page, companyId: z.uuid(), categoryId: z.uuid().optional(), from: isoDate.optional(), to: isoDate.optional(), status: z.enum(['posted', 'cancelled']).optional() });
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
