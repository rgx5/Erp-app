import { z } from 'zod';
import { isValidGstin } from './gstin.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const upper = (value: string) => value.trim().toUpperCase();

export const createCompanySchema = z.strictObject({
  legalName: text(300),
  tradeName: text(300).optional(),
  pan: z.string().transform(upper).pipe(z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Not a valid PAN')).optional(),
  baseCurrency: z.string().transform(upper).pipe(z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code')).default('INR'),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(4),
});

export const updateCompanySchema = z
  .strictObject({
    legalName: text(300).optional(),
    tradeName: text(300).nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

const isoDate = z.iso.date();

export const REGISTRATION_TYPES = ['regular', 'composition', 'sez_unit', 'sez_developer', 'casual', 'non_resident', 'isd', 'tds', 'tcs', 'ecommerce_operator'] as const;

export const createGstRegistrationSchema = z
  .strictObject({
    gstin: z.string().transform(upper).pipe(z.string().refine(isValidGstin, 'Not a valid GSTIN (format or check character)')),
    legalName: text(300),
    tradeName: text(300).optional(),
    registrationType: z.enum(REGISTRATION_TYPES).default('regular'),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.optional(),
  })
  .refine((v) => v.effectiveTo === undefined || v.effectiveTo >= v.effectiveFrom, { path: ['effectiveTo'], message: 'Must not be before effectiveFrom' });

export const createBusinessLocationSchema = z
  .strictObject({
    companyId: z.uuid(),
    gstRegistrationId: z.uuid().optional(),
    code: text(32),
    name: text(200),
    isPrincipalPlace: z.boolean().default(false),
    addressLine1: text(200),
    addressLine2: text(200).optional(),
    city: text(100),
    stateCode: z.string().regex(/^[0-9]{2}$/, 'Use the 2-digit state code'),
    pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Not a valid PIN code'),
  })
  .refine((v) => !v.isPrincipalPlace || v.gstRegistrationId !== undefined, { path: ['isPrincipalPlace'], message: 'A principal place of business needs a GST registration' });

export const WAREHOUSE_KINDS = ['general', 'raw_material', 'work_in_progress', 'finished_goods', 'scrap', 'quarantine', 'in_transit', 'subcontractor'] as const;

export const createWarehouseSchema = z.strictObject({
  businessLocationId: z.uuid(),
  code: text(32),
  name: text(200),
  kind: z.enum(WAREHOUSE_KINDS).default('general'),
});

export const listLocationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(100).optional(),
  companyId: z.uuid().optional(),
});
export const listWarehousesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(100).optional(),
  businessLocationId: z.uuid().optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type CreateGstRegistrationInput = z.infer<typeof createGstRegistrationSchema>;
export type CreateBusinessLocationInput = z.infer<typeof createBusinessLocationSchema>;
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;
export type ListLocationsQuery = z.infer<typeof listLocationsQuerySchema>;
export type ListWarehousesQuery = z.infer<typeof listWarehousesQuerySchema>;
