import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const money = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A non-negative decimal with at most 4 places, as a string');
const positive = money.refine((v) => Number(v) > 0, 'Must be greater than zero');
const quantity = z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,6})?$/, 'A positive decimal with at most 6 places, as a string').refine((v) => Number(v) > 0, 'Must be greater than zero');
const percent = z.string().regex(/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/);
const serials = z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/)).min(1).max(5000);
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };
const METHODS = ['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other'] as const;

export const posSettingsSchema = z.strictObject({ walkInCustomerId: z.uuid().nullable().optional(), cashVarianceAccountId: z.uuid().nullable().optional() }).refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export const paymentAccountSchema = z.strictObject({ method: z.enum(METHODS), accountId: z.uuid() });
export const createTerminalSchema = z.strictObject({
  companyId: z.uuid(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Letters, digits, - _ (max 20)'),
  name: text(100),
  gstRegistrationId: z.uuid(),
  businessLocationId: z.uuid(),
  warehouseId: z.uuid(),
});
export const openShiftSchema = z.strictObject({ terminalId: z.uuid(), openingCash: money.default('0'), date: isoDate.optional() });
export const closeShiftSchema = z.strictObject({ countedCash: money, date: isoDate.optional() });

export const posSaleSchema = z.strictObject({
  shiftId: z.uuid(),
  date: isoDate.optional(),
  /** Defaults to the company's walk-in customer. */
  customerId: z.uuid().optional(),
  lines: z
    .array(
      z.strictObject({
        itemId: z.uuid(),
        description: text(500).optional(),
        quantity,
        unitPrice: money,
        discountPercent: percent.default('0'),
        /** Counter prices include tax (MRP) unless said otherwise. */
        taxInclusive: z.boolean().default(true),
        taxCodeId: z.uuid().optional(),
        warehouseId: z.uuid().optional(),
        batchId: z.uuid().optional(),
        serialNos: serials.optional(),
      }),
    )
    .min(1)
    .max(200),
  /** Must add up to the invoice total exactly. Cash may be tendered above the amount; the difference is change. */
  payments: z.array(z.strictObject({ method: z.enum(METHODS), amount: positive, tendered: money.optional(), reference: text(100).optional() })).min(1).max(10),
});
export const posReturnSchema = z.strictObject({
  shiftId: z.uuid(),
  date: isoDate.optional(),
  originalSaleId: z.uuid(),
  reason: text(300),
  lines: z.array(z.strictObject({ originalLineId: z.uuid(), quantity, unitPrice: money.optional(), serialNos: serials.optional(), warehouseId: z.uuid().optional() })).min(1).max(200),
  /** How the money goes back; must add up to the credit note total. */
  refunds: z.array(z.strictObject({ method: z.enum(METHODS), amount: positive, reference: text(100).optional() })).min(1).max(10),
});
export const listShiftsQuery = z.object({ ...page, companyId: z.uuid(), terminalId: z.uuid().optional(), status: z.enum(['open', 'closed']).optional() });
export const listSalesQuery = z.object({ ...page, companyId: z.uuid(), shiftId: z.uuid().optional(), kind: z.enum(['sale', 'return']).optional() });
export const companyQuery = z.object({ companyId: z.uuid() });

export type PosSaleInput = z.infer<typeof posSaleSchema>;
export type PosReturnInput = z.infer<typeof posReturnSchema>;
