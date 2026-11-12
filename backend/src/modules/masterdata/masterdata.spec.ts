import { describe, expect, it } from 'vitest';
import { UQC } from './seed.js';
import { createAddressSchema, createItemSchema, createPartySchema, createPriceSchema, createTaxRateSchema, createUnitSchema, UQC_CODES } from './masterdata.schemas.js';
import { dayBefore } from './catalog.service.js';
import { gstinCheckCharacter } from '../organization/gstin.js';

const uuid = '0198f0aa-0000-7000-8000-000000000001';
const gstin = (() => { const f = '27ABCDE1234F1Z'; return f + gstinCheckCharacter(f); })();

describe('seed data', () => {
  it('seeds exactly the statutory UQC list', () => {
    expect(UQC.map((u) => u[0]).sort()).toEqual([...UQC_CODES].sort());
  });
});
describe('dayBefore', () => {
  it('handles month, year and leap boundaries', () => {
    expect(dayBefore('2025-04-01')).toBe('2025-03-31');
    expect(dayBefore('2025-01-01')).toBe('2024-12-31');
    expect(dayBefore('2024-03-01')).toBe('2024-02-29');
  });
});
describe('item rules', () => {
  const base = { code: 'RM-001', name: 'Steel rod', itemType: 'raw_material', baseUomId: uuid };
  it('defaults stock by type and checks HSN vs SAC', () => {
    expect(createItemSchema.parse(base).isStocked).toBe(true);
    expect(createItemSchema.parse({ ...base, itemType: 'service', hsnSacCode: '998314' }).isStocked).toBe(false);
    expect(createItemSchema.safeParse({ ...base, hsnSacCode: '7214' }).success).toBe(true);
    expect(createItemSchema.safeParse({ ...base, hsnSacCode: '72145' }).success).toBe(false);
    expect(createItemSchema.safeParse({ ...base, itemType: 'service', hsnSacCode: '7214' }).success).toBe(false);
  });
  it('keeps services unstocked and only manufactured goods manufactured', () => {
    expect(createItemSchema.safeParse({ ...base, itemType: 'service', isStocked: true }).success).toBe(false);
    expect(createItemSchema.safeParse({ ...base, tracking: 'batch', isStocked: false }).success).toBe(false);
    expect(createItemSchema.safeParse({ ...base, isManufactured: true }).success).toBe(false);
    expect(createItemSchema.safeParse({ ...base, itemType: 'finished_good', isManufactured: true, tracking: 'serial' }).success).toBe(true);
  });
});
describe('party rules', () => {
  const base = { code: 'C001', legalName: 'Acme', isCustomer: true, gstTreatment: 'registered_regular', gstin };
  it('derives the PAN from the GSTIN and requires a GSTIN exactly when registered', () => {
    expect(createPartySchema.parse(base).pan).toBe('ABCDE1234F');
    expect(createPartySchema.safeParse({ ...base, gstin: undefined }).success).toBe(false);
    expect(createPartySchema.safeParse({ ...base, gstTreatment: 'unregistered' }).success).toBe(false);
    expect(createPartySchema.safeParse({ ...base, pan: 'ZZZZZ9999Z' }).success).toBe(false);
    const wrong = gstin.slice(0, 14) + (gstin.endsWith('A') ? 'B' : 'A');
    expect(createPartySchema.safeParse({ ...base, gstin: wrong }).success).toBe(false);
  });
  it('needs a role and limits credit to customers', () => {
    expect(createPartySchema.safeParse({ ...base, isCustomer: false }).success).toBe(false);
    expect(createPartySchema.safeParse({ ...base, isCustomer: false, isSupplier: true, creditLimit: '100' }).success).toBe(false);
  });
});
describe('address, unit, tax and price inputs', () => {
  it('needs a PIN for India only', () => {
    const a = { kind: 'billing', line1: 'x', city: 'Pune', stateCode: '27' };
    expect(createAddressSchema.safeParse({ ...a, pincode: '411001' }).success).toBe(true);
    expect(createAddressSchema.safeParse(a).success).toBe(false);
    expect(createAddressSchema.safeParse({ ...a, country: 'US', stateCode: '96' }).success).toBe(true);
  });
  it('takes only statutory UQC codes', () => {
    expect(createUnitSchema.safeParse({ code: 'kg', name: 'Kilo', uqc: 'KGS' }).data?.code).toBe('KG');
    expect(createUnitSchema.safeParse({ code: 'KG', name: 'Kilo', uqc: 'KILO' }).success).toBe(false);
  });
  it('limits rates to 4 decimals and money to strings', () => {
    expect(createTaxRateSchema.safeParse({ effectiveFrom: '2025-04-01', igstRate: 18 }).success).toBe(true);
    expect(createTaxRateSchema.safeParse({ effectiveFrom: '2025-04-01', igstRate: 18.00001 }).success).toBe(false);
    expect(createTaxRateSchema.safeParse({ effectiveFrom: '2025-04-01', igstRate: 101 }).success).toBe(false);
    const p = { itemId: uuid, uomId: uuid, effectiveFrom: '2025-04-01' };
    expect(createPriceSchema.safeParse({ ...p, price: '10.50' }).success).toBe(true);
    expect(createPriceSchema.safeParse({ ...p, price: 10.5 }).success).toBe(false);
    expect(createPriceSchema.safeParse({ ...p, price: '10.12345' }).success).toBe(false);
    expect(createPriceSchema.safeParse({ ...p, price: '1', effectiveTo: '2025-03-01' }).success).toBe(false);
  });
});
