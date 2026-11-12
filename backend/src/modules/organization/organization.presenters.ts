import type { BusinessLocationRow, CompanyRow, GstRegistrationRow, TenantRow, WarehouseRow } from './organization.service.js';

const meta = (row: { version: number; createdAt: Date; updatedAt: Date }) => ({
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const presentTenant = (r: TenantRow) => ({ id: r.id, slug: r.slug, name: r.name, status: r.status, ...meta(r) });

export const presentCompany = (r: CompanyRow) => ({
  id: r.id,
  legalName: r.legalName,
  tradeName: r.tradeName,
  pan: r.pan,
  baseCurrency: r.baseCurrency,
  fiscalYearStartMonth: r.fiscalYearStartMonth,
  status: r.status,
  ...meta(r),
});

export const presentGstRegistration = (r: GstRegistrationRow) => ({
  id: r.id,
  companyId: r.companyId,
  gstin: r.gstin,
  stateCode: r.stateCode,
  legalName: r.legalName,
  tradeName: r.tradeName,
  registrationType: r.registrationType,
  status: r.status,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  ...meta(r),
});

export const presentBusinessLocation = (r: BusinessLocationRow) => ({
  id: r.id,
  companyId: r.companyId,
  gstRegistrationId: r.gstRegistrationId,
  code: r.code,
  name: r.name,
  isPrincipalPlace: r.isPrincipalPlace,
  address: { line1: r.addressLine1, line2: r.addressLine2, city: r.city, stateCode: r.stateCode, pincode: r.pincode },
  status: r.status,
  ...meta(r),
});

export const presentWarehouse = (r: WarehouseRow) => ({
  id: r.id,
  businessLocationId: r.businessLocationId,
  code: r.code,
  name: r.name,
  kind: r.kind,
  status: r.status,
  ...meta(r),
});

export const presentPage = <T, U>(page: { items: T[]; nextCursor: string | null }, present: (row: T) => U) => ({
  items: page.items.map(present),
  nextCursor: page.nextCursor,
});
