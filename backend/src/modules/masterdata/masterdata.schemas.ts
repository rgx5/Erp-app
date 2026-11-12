import { z } from 'zod';
import { isValidGstin } from '../organization/gstin.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const upper = (value: string) => value.trim().toUpperCase();
const isoDate = z.iso.date();
/** Decimals travel as strings so no precision is lost to floating point. */
const decimal = (scale: number, intDigits = 14) => z.string().regex(new RegExp(`^[0-9]{1,${intDigits}}(\\.[0-9]{1,${scale}})?$`), `A non-negative decimal with at most ${scale} places, as a string`);
const code = (re: RegExp, hint: string) => z.string().transform(upper).pipe(z.string().regex(re, hint));
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };
const atLeastOne = <T extends object>(v: T) => Object.keys(v).length > 0;
const NOTHING = 'Send at least one field to change';

export const UQC_CODES = ['BAG','BAL','BDL','BKL','BOU','BOX','BTL','BUN','CAN','CBM','CCM','CMS','CTN','DOZ','DRM','GGK','GMS','GRS','GYD','KGS','KLR','KME','MLT','MTR','MTS','NOS','OTH','PAC','PCS','PRS','QTL','ROL','SET','SQF','SQM','SQY','TBS','TGM','THD','TON','TUB','UGS','UNT','YDS'] as const;
export const ITEM_TYPES = ['raw_material', 'packing_material', 'semi_finished', 'finished_good', 'trading_good', 'consumable', 'service'] as const;
export const GST_TREATMENTS = ['registered_regular', 'registered_composition', 'sez', 'deemed_export', 'unregistered', 'consumer', 'overseas'] as const;
const REGISTERED = new Set<string>(['registered_regular', 'registered_composition', 'sez', 'deemed_export']);

// ---- currencies, rates, units --------------------------------------------------------------------------------------
export const createCurrencySchema = z.strictObject({ code: code(/^[A-Z]{3}$/, 'Use a 3-letter ISO code'), name: text(100), symbol: text(8).optional(), decimalPlaces: z.number().int().min(0).max(4).default(2) });
export const updateCurrencySchema = z.strictObject({ name: text(100).optional(), symbol: text(8).nullable().optional(), status: z.enum(['active', 'inactive']).optional() }).refine(atLeastOne, NOTHING);
export const createExchangeRateSchema = z
  .strictObject({ fromCurrency: code(/^[A-Z]{3}$/, 'Use a 3-letter code'), toCurrency: code(/^[A-Z]{3}$/, 'Use a 3-letter code'), rate: decimal(8, 10), effectiveDate: isoDate, source: text(100).optional() })
  .refine((v) => v.fromCurrency !== v.toCurrency, { path: ['toCurrency'], message: 'Must differ from fromCurrency' })
  .refine((v) => Number(v.rate) > 0, { path: ['rate'], message: 'Must be greater than zero' });
export const listExchangeRatesQuery = z.object({ ...page, fromCurrency: z.string().optional(), toCurrency: z.string().optional() });
export const resolveRateQuery = z.object({ from: code(/^[A-Z]{3}$/, 'Use a 3-letter code'), to: code(/^[A-Z]{3}$/, 'Use a 3-letter code'), date: isoDate });
export const createUnitSchema = z.strictObject({ code: code(/^[A-Z0-9]{1,10}$/, 'Up to 10 letters or digits'), name: text(100), uqc: z.enum(UQC_CODES).optional(), decimalPlaces: z.number().int().min(0).max(6).default(3) });
export const updateUnitSchema = z.strictObject({ name: text(100).optional(), decimalPlaces: z.number().int().min(0).max(6).optional(), status: z.enum(['active', 'inactive']).optional() }).refine(atLeastOne, NOTHING);

// ---- tax -----------------------------------------------------------------------------------------------------------
export const createTaxCodeSchema = z.strictObject({ code: code(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/, 'Letters, digits, . _ -'), name: text(100), kind: z.enum(['gst', 'exempt', 'nil_rated', 'non_gst']).default('gst') });
export const updateTaxCodeSchema = z.strictObject({ name: text(100).optional(), status: z.enum(['active', 'inactive']).optional() }).refine(atLeastOne, NOTHING);
const rate = z.number().min(0).max(100).multipleOf(0.0001);
/** Give the IGST rate; CGST and SGST are each half of it (the statutory intra-state split). */
export const createTaxRateSchema = z.strictObject({ effectiveFrom: isoDate, igstRate: rate.default(0), cessRate: z.number().min(0).max(1000).multipleOf(0.0001).default(0) });
export const dateQuery = z.object({ date: isoDate });

// ---- items ---------------------------------------------------------------------------------------------------------
const itemCode = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$/, 'Letters, digits and . _ / - (max 40)');
export const createItemSchema = z
  .strictObject({
    code: itemCode,
    name: text(300),
    description: text(2000).optional(),
    itemType: z.enum(ITEM_TYPES),
    baseUomId: z.uuid(),
    hsnSacCode: z.string().regex(/^[0-9]{4,8}$/, 'Digits only').optional(),
    taxCodeId: z.uuid().optional(),
    tracking: z.enum(['none', 'batch', 'serial']).default('none'),
    isStocked: z.boolean().optional(),
    isPurchasable: z.boolean().default(true),
    isSellable: z.boolean().default(true),
    isManufactured: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const service = v.itemType === 'service';
    const stocked = v.isStocked ?? !service;
    if (v.hsnSacCode !== undefined) {
      const ok = service ? /^99[0-9]{4}$/.test(v.hsnSacCode) : /^([0-9]{4}|[0-9]{6}|[0-9]{8})$/.test(v.hsnSacCode);
      if (!ok) ctx.addIssue({ code: 'custom', path: ['hsnSacCode'], message: service ? 'A SAC is 6 digits starting 99' : 'An HSN is 4, 6 or 8 digits' });
    }
    if (service && (stocked || v.tracking !== 'none' || v.isManufactured)) ctx.addIssue({ code: 'custom', path: ['itemType'], message: 'A service is not stocked, tracked or manufactured' });
    if (v.tracking !== 'none' && !stocked) ctx.addIssue({ code: 'custom', path: ['tracking'], message: 'Only stocked items can be batch or serial tracked' });
    if (v.isManufactured && v.itemType !== 'semi_finished' && v.itemType !== 'finished_good') ctx.addIssue({ code: 'custom', path: ['isManufactured'], message: 'Only semi-finished or finished goods are manufactured' });
  })
  .transform((v) => ({ ...v, isStocked: v.isStocked ?? v.itemType !== 'service' }));
export const updateItemSchema = z
  .strictObject({
    name: text(300).optional(),
    description: text(2000).nullable().optional(),
    hsnSacCode: z.string().regex(/^[0-9]{4,8}$/).nullable().optional(),
    taxCodeId: z.uuid().nullable().optional(),
    isPurchasable: z.boolean().optional(),
    isSellable: z.boolean().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .refine(atLeastOne, NOTHING);
export const listItemsQuery = z.object({ ...page, itemType: z.enum(ITEM_TYPES).optional(), status: z.enum(['active', 'inactive']).optional(), q: z.string().trim().min(1).max(60).optional() });
export const createConversionSchema = z.strictObject({ uomId: z.uuid(), factor: decimal(8, 10) }).refine((v) => Number(v.factor) > 0, { path: ['factor'], message: 'Must be greater than zero' });

// ---- parties -------------------------------------------------------------------------------------------------------
export const createPaymentTermSchema = z.strictObject({ code: code(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/, 'Letters, digits, . _ -'), name: text(100), netDays: z.number().int().min(0).max(365) });
export const createPartySchema = z
  .strictObject({
    code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$/, 'Letters, digits and . _ / - (max 40)'),
    legalName: text(300),
    tradeName: text(300).optional(),
    isCustomer: z.boolean().default(false),
    isSupplier: z.boolean().default(false),
    isSubcontractor: z.boolean().default(false),
    gstTreatment: z.enum(GST_TREATMENTS),
    gstin: z.string().transform(upper).pipe(z.string().refine(isValidGstin, 'Not a valid GSTIN (format or check character)')).optional(),
    pan: code(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Not a valid PAN').optional(),
    currency: code(/^[A-Z]{3}$/, 'Use a 3-letter code').default('INR'),
    paymentTermsId: z.uuid().optional(),
    creditLimit: decimal(4).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.isCustomer && !v.isSupplier && !v.isSubcontractor) ctx.addIssue({ code: 'custom', path: ['isCustomer'], message: 'Choose at least one role: customer, supplier or subcontractor' });
    if (REGISTERED.has(v.gstTreatment) !== (v.gstin !== undefined)) ctx.addIssue({ code: 'custom', path: ['gstin'], message: REGISTERED.has(v.gstTreatment) ? 'A registered party needs a GSTIN' : 'This GST treatment has no GSTIN' });
    if (v.gstin && v.pan && v.gstin.slice(2, 12) !== v.pan) ctx.addIssue({ code: 'custom', path: ['pan'], message: 'The PAN must match the one inside the GSTIN' });
    if (v.creditLimit !== undefined && !v.isCustomer) ctx.addIssue({ code: 'custom', path: ['creditLimit'], message: 'Only customers have a credit limit' });
  })
  .transform((v) => ({ ...v, pan: v.pan ?? (v.gstin ? v.gstin.slice(2, 12) : undefined) }));
export const updatePartySchema = z
  .strictObject({ legalName: text(300).optional(), tradeName: text(300).nullable().optional(), paymentTermsId: z.uuid().nullable().optional(), creditLimit: decimal(4).nullable().optional(), status: z.enum(['active', 'inactive', 'blocked']).optional() })
  .refine(atLeastOne, NOTHING);
export const listPartiesQuery = z.object({ ...page, role: z.enum(['customer', 'supplier', 'subcontractor']).optional(), status: z.enum(['active', 'inactive', 'blocked']).optional(), q: z.string().trim().min(1).max(60).optional() });
export const createAddressSchema = z
  .strictObject({ kind: z.enum(['billing', 'shipping', 'registered', 'other']), line1: text(200), line2: text(200).optional(), city: text(100), stateCode: z.string().regex(/^[0-9]{2}$/, 'Use the 2-digit GST state code'), pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Not a valid PIN code').optional(), country: code(/^[A-Z]{2}$/, 'Use a 2-letter country code').default('IN'), isDefault: z.boolean().default(false) })
  .refine((v) => (v.country === 'IN') === (v.pincode !== undefined), { path: ['pincode'], message: 'Indian addresses need a PIN code; foreign addresses must not have one' });

// ---- pricing -------------------------------------------------------------------------------------------------------
export const createPriceListSchema = z.strictObject({ code: code(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/, 'Letters, digits, . _ -'), name: text(100), kind: z.enum(['sales', 'purchase']), currency: code(/^[A-Z]{3}$/, 'Use a 3-letter code').default('INR'), taxInclusive: z.boolean().default(false) });
export const updatePriceListSchema = z.strictObject({ name: text(100).optional(), status: z.enum(['active', 'inactive']).optional() }).refine(atLeastOne, NOTHING);
export const createPriceSchema = z
  .strictObject({ itemId: z.uuid(), uomId: z.uuid(), minQty: decimal(6).default('0'), price: decimal(4), effectiveFrom: isoDate, effectiveTo: isoDate.optional() })
  .refine((v) => v.effectiveTo === undefined || v.effectiveTo >= v.effectiveFrom, { path: ['effectiveTo'], message: 'Must not be before effectiveFrom' });
export const listPricesQuery = z.object({ ...page, itemId: z.uuid().optional() });
export const resolvePriceQuery = z.object({ itemId: z.uuid(), uomId: z.uuid(), qty: decimal(6).default('1'), date: isoDate });
export const closePriceSchema = z.strictObject({ effectiveTo: isoDate });

export const pageQuery = z.object(page);
export type CreateCurrencyInput = z.infer<typeof createCurrencySchema>;
export type UpdateCurrencyInput = z.infer<typeof updateCurrencySchema>;
export type CreateExchangeRateInput = z.infer<typeof createExchangeRateSchema>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
export type CreateTaxCodeInput = z.infer<typeof createTaxCodeSchema>;
export type UpdateTaxCodeInput = z.infer<typeof updateTaxCodeSchema>;
export type CreateTaxRateInput = z.infer<typeof createTaxRateSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type ListItemsQuery = z.infer<typeof listItemsQuery>;
export type CreatePaymentTermInput = z.infer<typeof createPaymentTermSchema>;
export type CreatePartyInput = z.infer<typeof createPartySchema>;
export type UpdatePartyInput = z.infer<typeof updatePartySchema>;
export type ListPartiesQuery = z.infer<typeof listPartiesQuery>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type CreatePriceListInput = z.infer<typeof createPriceListSchema>;
export type UpdatePriceListInput = z.infer<typeof updatePriceListSchema>;
export type CreatePriceInput = z.infer<typeof createPriceSchema>;
