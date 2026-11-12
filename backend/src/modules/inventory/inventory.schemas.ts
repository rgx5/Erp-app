import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const quantity = z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,6})?$/, 'A positive decimal with at most 6 places, as a string').refine((v) => Number(v) > 0, 'Must be greater than zero');
const unitCost = z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,6})?$/, 'A non-negative decimal with at most 6 places, as a string');
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };
const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/, 'Letters, digits and . _ / - (max 40)');
export const STOCKED_TYPES = ['raw_material', 'packing_material', 'semi_finished', 'finished_good', 'trading_good', 'consumable'] as const;

export const stockSettingsSchema = z.strictObject({ adjustmentAccountId: z.uuid().nullable().optional(), openingBalanceAccountId: z.uuid().nullable().optional() }).refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export const inventoryAccountSchema = z.strictObject({ itemType: z.enum(STOCKED_TYPES), accountId: z.uuid() });
export const warehouseStockSettingsSchema = z.strictObject({ allowNegativeStock: z.boolean() });
export const createBatchSchema = z
  .strictObject({ batchNo: code, manufactureDate: isoDate.optional(), expiryDate: isoDate.optional() })
  .refine((v) => !v.manufactureDate || !v.expiryDate || v.expiryDate >= v.manufactureDate, { path: ['expiryDate'], message: 'Must not be before the manufacture date' });
export const batchStatusSchema = z.strictObject({ status: z.enum(['active', 'blocked']) });

export const movementLineSchema = z
  .strictObject({
    warehouseId: z.uuid(),
    itemId: z.uuid(),
    quantity,
    direction: z.enum(['in', 'out']).optional(),
    unitCost: unitCost.optional(),
    batchId: z.uuid().optional(),
    batch: createBatchSchema.optional(),
    serialNos: z.array(code).min(1).max(5000).optional(),
  })
  .refine((l) => !(l.batchId && l.batch), { path: ['batch'], message: 'Give a batchId or a batch to create, not both' });

export const postMovementSchema = z
  .strictObject({
    companyId: z.uuid(),
    movementType: z.enum(['opening', 'receipt', 'issue', 'adjustment']),
    postingDate: isoDate,
    description: text(500),
    /** Receipts and issues post against this account (a non-control account). Opening stock and adjustments use the company's configured accounts. */
    offsetAccountId: z.uuid().optional(),
    lines: z.array(movementLineSchema).min(1).max(200),
  })
  .superRefine((v, ctx) => {
    v.lines.forEach((line, i) => {
      const path = ['lines', i, 'direction'];
      if (v.movementType === 'adjustment' && !line.direction) ctx.addIssue({ code: 'custom', path, message: 'An adjustment line needs a direction (in or out)' });
      if (v.movementType !== 'adjustment' && line.direction) ctx.addIssue({ code: 'custom', path, message: 'Only adjustments take a direction' });
      const incoming = v.movementType === 'opening' || v.movementType === 'receipt' || line.direction === 'in';
      if (incoming && (v.movementType === 'opening' || v.movementType === 'receipt') && line.unitCost === undefined) ctx.addIssue({ code: 'custom', path: ['lines', i, 'unitCost'], message: 'A receipt line needs a unit cost' });
      if (!incoming && line.unitCost !== undefined) ctx.addIssue({ code: 'custom', path: ['lines', i, 'unitCost'], message: 'Issues are costed by the valuation method, not by you' });
      if (!incoming && line.batch) ctx.addIssue({ code: 'custom', path: ['lines', i, 'batch'], message: 'Only incoming lines can create a batch' });
    });
    const needsOffset = v.movementType === 'receipt' || v.movementType === 'issue';
    if (needsOffset && !v.offsetAccountId) ctx.addIssue({ code: 'custom', path: ['offsetAccountId'], message: 'A receipt or issue needs the account to post against' });
    if (!needsOffset && v.offsetAccountId) ctx.addIssue({ code: 'custom', path: ['offsetAccountId'], message: 'Opening stock and adjustments use the accounts in the company stock settings' });
  });

export const listMovementsQuery = z.object({ ...page, companyId: z.uuid(), from: isoDate.optional(), to: isoDate.optional(), movementType: z.enum(['opening', 'receipt', 'issue', 'adjustment', 'transfer_dispatch', 'transfer_receipt', 'transfer_direct', 'count_adjustment']).optional(), itemId: z.uuid().optional() });
export const balancesQuery = z.object({ companyId: z.uuid(), warehouseId: z.uuid().optional(), itemId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });
export const stockCardQuery = z.object({ ...page, companyId: z.uuid(), itemId: z.uuid(), warehouseId: z.uuid().optional(), from: isoDate.optional(), to: isoDate.optional() });
export const asOfQuery = z.object({ companyId: z.uuid(), asOf: isoDate });
export const listSerialsQuery = z.object({ ...page, itemId: z.uuid(), status: z.enum(['in_stock', 'issued']).optional(), warehouseId: z.uuid().optional() });

export type PostMovementInput = z.infer<typeof postMovementSchema>;
export type MovementLineInput = z.infer<typeof movementLineSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
