import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const money = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A non-negative decimal with at most 4 places, as a string');
const positive = money.refine((v) => Number(v) > 0, 'Must be greater than zero');
const rate = z.string().regex(/^[0-9]{1,6}(\.[0-9]{1,4})?$/, 'A non-negative decimal with at most 4 places, as a string');
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };

export const retailSettingsSchema = z.strictObject({ loyaltyPointsPerHundred: rate.optional(), loyaltyRupeesPerPoint: rate.optional(), maxDiscountWithoutApproval: z.string().regex(/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/, 'A percentage from 0 to 100').nullable().optional() }).refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export const companyQuery = z.object({ companyId: z.uuid() });
export const walletQuery = z.object({ companyId: z.uuid() });
export const adjustPointsSchema = z.strictObject({ companyId: z.uuid(), customerId: z.uuid(), points: z.string().regex(/^-?[0-9]{1,10}(\.[0-9]{1,2})?$/, 'Points, up to 2 decimals, may be negative').refine((v) => Number(v) !== 0, 'Cannot be zero'), note: text(300) });
export const createCouponSchema = z.strictObject({
  companyId: z.uuid(), code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$/, '3 to 30 letters, digits, - or _'), description: text(200).optional(),
  kind: z.enum(['percent', 'fixed']), value: positive, minBill: money.default('0'), maxDiscount: positive.optional(), validFrom: isoDate.optional(), validTo: isoDate.optional(), maxUses: z.number().int().min(1).max(1_000_000).optional(),
}).refine((v) => v.kind !== 'percent' || Number(v.value) <= 100, { path: ['value'], message: 'A percentage cannot exceed 100' }).refine((v) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom, { path: ['validTo'], message: 'Must not be before the start' });
export const updateCouponSchema = z.strictObject({ description: text(200).nullable().optional(), status: z.enum(['active', 'inactive']).optional(), validTo: isoDate.nullable().optional(), maxUses: z.number().int().min(1).max(1_000_000).nullable().optional() }).refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');
export const listCouponsQuery = z.object({ ...page, companyId: z.uuid(), status: z.enum(['active', 'inactive']).optional() });
export const validateCouponSchema = z.strictObject({ companyId: z.uuid(), code: z.string().trim().min(1).max(30), billTotal: money, date: isoDate.optional() });
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
