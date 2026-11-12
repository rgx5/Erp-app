import { describe, expect, it } from 'vitest';
import {
  createBusinessLocationSchema,
  createCompanySchema,
  createGstRegistrationSchema,
  updateCompanySchema,
} from './organization.schemas.js';

const uuid = '0198f0aa-0000-7000-8000-000000000001';

describe('organization schemas', () => {
  it('normalises a company', () => {
    const parsed = createCompanySchema.parse({ legalName: '  Acme Pvt Ltd ', pan: 'aapfu0939f' });
    expect(parsed).toMatchObject({ legalName: 'Acme Pvt Ltd', pan: 'AAPFU0939F', baseCurrency: 'INR', fiscalYearStartMonth: 4 });
  });
  it('rejects unknown fields instead of ignoring them', () => {
    expect(createCompanySchema.safeParse({ legalName: 'A', tenantId: uuid }).success).toBe(false);
  });
  it('validates the GSTIN check character and the registration period', () => {
    const ok = { gstin: '27aapfu0939f1zv', legalName: 'Acme', effectiveFrom: '2024-04-01' };
    expect(createGstRegistrationSchema.parse(ok).gstin).toBe('27AAPFU0939F1ZV');
    expect(createGstRegistrationSchema.safeParse({ ...ok, gstin: '27AAPFU0939F1ZA' }).success).toBe(false);
    expect(createGstRegistrationSchema.safeParse({ ...ok, effectiveTo: '2024-03-31' }).success).toBe(false);
    expect(createGstRegistrationSchema.safeParse({ ...ok, effectiveFrom: '2024-13-01' }).success).toBe(false);
  });
  it('requires a GST registration for a principal place of business', () => {
    const location = { companyId: uuid, code: 'HO', name: 'Head office', addressLine1: 'x', city: 'Pune', stateCode: '27', pincode: '411001' };
    expect(createBusinessLocationSchema.safeParse({ ...location, isPrincipalPlace: true }).success).toBe(false);
    expect(createBusinessLocationSchema.safeParse({ ...location, isPrincipalPlace: true, gstRegistrationId: uuid }).success).toBe(true);
    expect(createBusinessLocationSchema.safeParse({ ...location, pincode: '011001' }).success).toBe(false);
  });
  it('requires at least one field to update a company', () => {
    expect(updateCompanySchema.safeParse({}).success).toBe(false);
    expect(updateCompanySchema.safeParse({ tradeName: null }).success).toBe(true);
  });
});
