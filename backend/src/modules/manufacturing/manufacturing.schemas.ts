import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const money = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A non-negative decimal with at most 4 places, as a string');
const hours = z.string().regex(/^[0-9]{1,8}(\.[0-9]{1,4})?$/, 'Hours as a non-negative decimal with at most 4 places, as a string');
const quantity = z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,6})?$/, 'A positive decimal with at most 6 places, as a string').refine((v) => Number(v) > 0, 'Must be greater than zero');
const percent = z.string().regex(/^([0-9]{1,2}(\.[0-9]{1,4})?)$/, 'A percentage from 0 up to (not including) 100, as a string');
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };

export const createWorkCentreSchema = z.strictObject({
  companyId: z.uuid(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,29}$/),
  name: text(120),
  labourRatePerHour: money.default('0'),
  machineRatePerHour: money.default('0'),
  overheadRatePerHour: money.default('0'),
});
export const updateWorkCentreSchema = z
  .strictObject({ name: text(120).optional(), labourRatePerHour: money.optional(), machineRatePerHour: money.optional(), overheadRatePerHour: money.optional(), status: z.enum(['active', 'inactive']).optional() })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export const listWorkCentresQuery = z.object({ ...page, companyId: z.uuid(), status: z.enum(['active', 'inactive']).optional() });

export const createBomSchema = z
  .strictObject({
    companyId: z.uuid(),
    itemId: z.uuid(),
    description: text(300).optional(),
    /** The quantity of the finished item that the lines and operations below produce. */
    baseQuantity: quantity.default('1'),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.optional(),
    lines: z.array(z.strictObject({ itemId: z.uuid(), quantity, scrapPercent: percent.default('0'), notes: text(200).optional() })).min(1).max(300),
    operations: z.array(z.strictObject({ opNo: z.number().int().positive(), name: text(120), workCentreId: z.uuid(), setupHours: hours.default('0'), runHours: hours.default('0') })).max(100).default([]),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { path: ['effectiveTo'], message: 'Must not be before effectiveFrom' });
export const obsoleteBomSchema = z.strictObject({ effectiveTo: isoDate.optional() });
export const listBomsQuery = z.object({ ...page, companyId: z.uuid(), itemId: z.uuid().optional(), status: z.enum(['active', 'obsolete']).optional() });
export const explodeQuery = z.object({ companyId: z.uuid(), itemId: z.uuid(), quantity: quantity.default('1'), date: isoDate });
export type CreateWorkCentreInput = z.infer<typeof createWorkCentreSchema>;
export type UpdateWorkCentreInput = z.infer<typeof updateWorkCentreSchema>;
export type CreateBomInput = z.infer<typeof createBomSchema>;
