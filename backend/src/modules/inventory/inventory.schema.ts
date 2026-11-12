import { sql } from 'drizzle-orm';
import { bigint, date, integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0007_inventory.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const qty = (name: string) => numeric(name, { precision: 18, scale: 6 });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const txId = () => bigint('tx_id', { mode: 'number' }).notNull().default(sql`txid_current()`);
const meta = { version: integer('version').notNull().default(1), createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow() };

export const companyStockSettings = erp.table('company_stock_settings', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  adjustmentAccountId: uuid('adjustment_account_id'),
  openingBalanceAccountId: uuid('opening_balance_account_id'),
  ...meta,
});
export const inventoryAccounts = erp.table('inventory_accounts', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  itemType: text('item_type').notNull(),
  accountId: uuid('account_id').notNull(),
  ...meta,
});
export const batches = erp.table('batches', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  itemId: uuid('item_id').notNull(),
  batchNo: text('batch_no').notNull(),
  manufactureDate: day('manufacture_date'),
  expiryDate: day('expiry_date'),
  status: text('status').notNull().default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
export const stockCounters = erp.table('stock_counters', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  fiscalYearId: uuid('fiscal_year_id').notNull(),
  prefix: text('prefix').notNull(),
  nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
});
export const stockMovements = erp.table('stock_movements', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  movementNo: text('movement_no').notNull(),
  movementType: text('movement_type').notNull(),
  postingDate: day('posting_date').notNull(),
  description: text('description').notNull(),
  sourceType: text('source_type').notNull().default('manual'),
  sourceId: text('source_id'),
  sourceEvent: text('source_event').notNull().default('post'),
  journalEntryId: uuid('journal_entry_id'),
  postedBy: uuid('posted_by'),
  postedAt: ts('posted_at').notNull().defaultNow(),
  txId: txId(),
});
export const stockLedger = erp.table('stock_ledger', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  movementId: uuid('movement_id').notNull(),
  companyId: uuid('company_id').notNull(),
  lineNo: integer('line_no').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  itemId: uuid('item_id').notNull(),
  batchId: uuid('batch_id'),
  postingDate: day('posting_date').notNull(),
  quantity: qty('quantity').notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 6 }).notNull(),
  value: money('value').notNull(),
  balanceQuantity: qty('balance_quantity').notNull(),
  balanceValue: money('balance_value').notNull(),
  txId: txId(),
});
export const stockSerials = erp.table('stock_serials', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  itemId: uuid('item_id').notNull(),
  serialNo: text('serial_no').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  status: text('status').notNull().default('in_stock'),
  receiptLedgerId: uuid('receipt_ledger_id').notNull(),
  issueLedgerId: uuid('issue_ledger_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const stockLedgerSerials = erp.table('stock_ledger_serials', {
  tenantId: uuid('tenant_id').notNull(),
  ledgerId: uuid('ledger_id').notNull(),
  serialId: uuid('serial_id').notNull(),
});
export const stockBalances = erp.table('stock_balances', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  itemId: uuid('item_id').notNull(),
  quantity: qty('quantity').notNull().default('0'),
  value: money('value').notNull().default('0'),
  lastCost: numeric('last_cost', { precision: 18, scale: 6 }).notNull().default('0'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const batchBalances = erp.table('batch_balances', {
  tenantId: uuid('tenant_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  itemId: uuid('item_id').notNull(),
  batchId: uuid('batch_id').notNull(),
  quantity: qty('quantity').notNull().default('0'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const stockLayers = erp.table('stock_layers', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  itemId: uuid('item_id').notNull(),
  ledgerId: uuid('ledger_id').notNull(),
  receivedOn: day('received_on').notNull(),
  quantity: qty('quantity').notNull(),
  remaining: qty('remaining').notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 6 }).notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});
export const stockLayerConsumptions = erp.table('stock_layer_consumptions', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  issueLedgerId: uuid('issue_ledger_id').notNull(),
  layerId: uuid('layer_id').notNull(),
  quantity: qty('quantity').notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 6 }).notNull(),
  value: money('value').notNull(),
});
