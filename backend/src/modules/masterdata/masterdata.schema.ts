import { boolean, char, date, integer, numeric, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0005_master_data.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const meta = {
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};
const day = (name: string) => date(name, { mode: 'string' });

export const currencies = erp.table('currencies', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  code: char('code', { length: 3 }).notNull(),
  name: text('name').notNull(),
  symbol: text('symbol'),
  decimalPlaces: smallint('decimal_places').notNull().default(2),
  status: text('status').notNull().default('active'),
  ...meta,
});

export const exchangeRates = erp.table('exchange_rates', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  fromCurrency: char('from_currency', { length: 3 }).notNull(),
  toCurrency: char('to_currency', { length: 3 }).notNull(),
  rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
  effectiveDate: day('effective_date').notNull(),
  source: text('source'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const units = erp.table('units', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  uqc: text('uqc'),
  decimalPlaces: smallint('decimal_places').notNull().default(3),
  status: text('status').notNull().default('active'),
  ...meta,
});

export const taxCodes = erp.table('tax_codes', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('gst'),
  status: text('status').notNull().default('active'),
  ...meta,
});

export const taxCodeRates = erp.table('tax_code_rates', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  taxCodeId: uuid('tax_code_id').notNull(),
  effectiveFrom: day('effective_from').notNull(),
  effectiveTo: day('effective_to'),
  igstRate: numeric('igst_rate', { precision: 7, scale: 4 }).notNull().default('0'),
  cgstRate: numeric('cgst_rate', { precision: 7, scale: 4 }).notNull().default('0'),
  sgstRate: numeric('sgst_rate', { precision: 7, scale: 4 }).notNull().default('0'),
  cessRate: numeric('cess_rate', { precision: 7, scale: 4 }).notNull().default('0'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const items = erp.table('items', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  itemType: text('item_type').notNull(),
  baseUomId: uuid('base_uom_id').notNull(),
  hsnSacCode: text('hsn_sac_code'),
  taxCodeId: uuid('tax_code_id'),
  tracking: text('tracking').notNull().default('none'),
  isStocked: boolean('is_stocked').notNull().default(true),
  isPurchasable: boolean('is_purchasable').notNull().default(true),
  isSellable: boolean('is_sellable').notNull().default(true),
  isManufactured: boolean('is_manufactured').notNull().default(false),
  costingMethod: text('costing_method'),
  status: text('status').notNull().default('active'),
  ...meta,
});

export const itemUomConversions = erp.table('item_uom_conversions', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  itemId: uuid('item_id').notNull(),
  uomId: uuid('uom_id').notNull(),
  factor: numeric('factor', { precision: 18, scale: 8 }).notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const paymentTerms = erp.table('payment_terms', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  netDays: integer('net_days').notNull(),
  status: text('status').notNull().default('active'),
  ...meta,
});

export const parties = erp.table('parties', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  code: text('code').notNull(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  isCustomer: boolean('is_customer').notNull().default(false),
  isSupplier: boolean('is_supplier').notNull().default(false),
  isSubcontractor: boolean('is_subcontractor').notNull().default(false),
  gstTreatment: text('gst_treatment').notNull(),
  gstin: char('gstin', { length: 15 }),
  pan: text('pan'),
  currency: char('currency', { length: 3 }).notNull().default('INR'),
  paymentTermsId: uuid('payment_terms_id'),
  creditLimit: numeric('credit_limit', { precision: 18, scale: 4 }),
  status: text('status').notNull().default('active'),
  ...meta,
});

export const partyAddresses = erp.table('party_addresses', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  partyId: uuid('party_id').notNull(),
  kind: text('kind').notNull(),
  line1: text('line1').notNull(),
  line2: text('line2'),
  city: text('city').notNull(),
  stateCode: char('state_code', { length: 2 }).notNull(),
  pincode: char('pincode', { length: 6 }),
  country: char('country', { length: 2 }).notNull().default('IN'),
  isDefault: boolean('is_default').notNull().default(false),
  status: text('status').notNull().default('active'),
  ...meta,
});

export const priceLists = erp.table('price_lists', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  taxInclusive: boolean('tax_inclusive').notNull().default(false),
  status: text('status').notNull().default('active'),
  ...meta,
});

export const priceListItems = erp.table('price_list_items', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  priceListId: uuid('price_list_id').notNull(),
  itemId: uuid('item_id').notNull(),
  uomId: uuid('uom_id').notNull(),
  minQty: numeric('min_qty', { precision: 18, scale: 6 }).notNull().default('0'),
  price: numeric('price', { precision: 18, scale: 4 }).notNull(),
  effectiveFrom: day('effective_from').notNull(),
  effectiveTo: day('effective_to'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
