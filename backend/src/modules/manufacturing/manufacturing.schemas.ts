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

// ---- settings and work orders -----------------------------------------------------------------------------------------
const account = z.uuid().nullable().optional();
const serials = z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/)).min(1).max(5000);
export const manufacturingSettingsSchema = z
  .strictObject({ wipAccountId: account, labourAbsorbedAccountId: account, overheadAbsorbedAccountId: account, productionVarianceAccountId: account, subcontractClearingAccountId: account })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export type ManufacturingSettingsInput = z.infer<typeof manufacturingSettingsSchema>;

export const createWorkOrderSchema = z.strictObject({
  companyId: z.uuid(),
  itemId: z.uuid(),
  /** Defaults to the BOM in force on the order date. */
  bomId: z.uuid().optional(),
  orderDate: isoDate,
  plannedQuantity: quantity,
  /** Where finished goods are received. */
  outputWarehouseId: z.uuid(),
  /** Where materials are taken from unless a line says otherwise. */
  materialsWarehouseId: z.uuid(),
  plannedStart: isoDate.optional(),
  dueDate: isoDate.optional(),
  notes: text(500).optional(),
});
export const issueMaterialsSchema = z.strictObject({
  date: isoDate,
  lines: z.array(z.strictObject({ itemId: z.uuid(), quantity, warehouseId: z.uuid().optional(), batchId: z.uuid().optional(), serialNos: serials.optional() })).min(1).max(200),
});
export const returnMaterialsSchema = z.strictObject({
  date: isoDate,
  lines: z.array(z.strictObject({ itemId: z.uuid(), quantity, warehouseId: z.uuid().optional(), batchId: z.uuid().optional(), serialNos: serials.optional() })).min(1).max(200),
});
export const reportTimeSchema = z.strictObject({
  date: isoDate,
  lines: z.array(z.strictObject({ opNo: z.number().int().positive(), hours: z.string().regex(/^[0-9]{1,8}(\.[0-9]{1,4})?$/).refine((v) => Number(v) > 0, 'Must be greater than zero') })).min(1).max(100),
});
export const reportOutputSchema = z.strictObject({
  date: isoDate,
  /** Good units received into stock. */
  quantity,
  /** Units spoiled in the process: recorded, and their cost stays with the good units. */
  scrapQuantity: z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,6})?$/).default('0'),
  batch: z.strictObject({ batchNo: text(60), manufactureDate: isoDate.optional(), expiryDate: isoDate.optional() }).optional(),
  batchId: z.uuid().optional(),
  serialNos: serials.optional(),
});
export const completeWorkOrderSchema = z.strictObject({ date: isoDate });
export const listWorkOrdersQuery = z.object({ ...page, companyId: z.uuid(), itemId: z.uuid().optional(), status: z.enum(['planned', 'released', 'in_progress', 'completed', 'cancelled']).optional() });
export const wipQuery = z.object({ companyId: z.uuid(), asOf: isoDate });
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export type IssueMaterialsInput = z.infer<typeof issueMaterialsSchema>;
export type ReportTimeInput = z.infer<typeof reportTimeSchema>;
export type ReportOutputInput = z.infer<typeof reportOutputSchema>;

export const rollupQuery = z.object({ companyId: z.uuid(), itemId: z.uuid(), quantity: quantity.default('1'), date: isoDate });
export const variancesQuery = z.object({ companyId: z.uuid(), from: isoDate, to: isoDate, itemId: z.uuid().optional() }).refine((v) => v.to >= v.from, { path: ['to'], message: 'Must not be before from' });

// ---- subcontracting -------------------------------------------------------------------------------------------------------
const challanLine = z.strictObject({ itemId: z.uuid(), quantity, batchId: z.uuid().optional(), serialNos: serials.optional() });
export const createSubcontractOrderSchema = createWorkOrderSchema.omit({ materialsWarehouseId: true }).extend({
  subcontractorId: z.uuid(),
  /** The job worker's own location, a warehouse of kind `subcontractor`: where our materials sit while they work on them. */
  jobWorkerWarehouseId: z.uuid(),
  /** Where materials are sent from (and unused ones come back to). */
  sourceWarehouseId: z.uuid(),
  /** The job-work charge per finished unit, before tax. */
  ratePerUnit: money,
});
export const sendChallanSchema = z.strictObject({ date: isoDate, vehicleNo: text(20).optional(), ewayBillNo: text(20).optional(), lines: z.array(challanLine).min(1).max(200) });
export const receiveJobWorkSchema = z.strictObject({
  date: isoDate,
  /** Good units received from the job worker. */
  quantity,
  scrapQuantity: z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,6})?$/).default('0'),
  /** The job-work charge for this receipt; defaults to rate x quantity. */
  chargeAmount: money.optional(),
  /** Materials actually used; defaults to the BOM requirement for the quantity received. */
  consumption: z.array(z.strictObject({ itemId: z.uuid(), quantity })).max(200).optional(),
  batch: z.strictObject({ batchNo: text(60), manufactureDate: isoDate.optional(), expiryDate: isoDate.optional() }).optional(),
  batchId: z.uuid().optional(),
  serialNos: serials.optional(),
});
export const listSubcontractQuery = z.object({ ...page, companyId: z.uuid(), subcontractorId: z.uuid().optional(), status: z.enum(['open', 'closed', 'cancelled']).optional() });
export type CreateSubcontractOrderInput = z.infer<typeof createSubcontractOrderSchema>;
export type SendChallanInput = z.infer<typeof sendChallanSchema>;
export type ReceiveJobWorkInput = z.infer<typeof receiveJobWorkSchema>;
