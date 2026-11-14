import { date, integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0018_manufacturing_masters.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const quantity = (name: string) => numeric(name, { precision: 18, scale: 6 });

export const workCentres = erp.table('work_centres', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  labourRatePerHour: money('labour_rate_per_hour').notNull().default('0'),
  machineRatePerHour: money('machine_rate_per_hour').notNull().default('0'),
  overheadRatePerHour: money('overhead_rate_per_hour').notNull().default('0'),
  status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const boms = erp.table('boms', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  itemId: uuid('item_id').notNull(),
  bomNo: text('bom_no').notNull(),
  version: integer('version').notNull(),
  description: text('description'),
  baseQuantity: quantity('base_quantity').notNull().default('1'),
  effectiveFrom: day('effective_from').notNull(),
  effectiveTo: day('effective_to'),
  status: text('status').notNull().default('active'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const bomLines = erp.table('bom_lines', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  bomId: uuid('bom_id').notNull(),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id').notNull(),
  quantity: quantity('quantity').notNull(),
  scrapPercent: numeric('scrap_percent', { precision: 7, scale: 4 }).notNull().default('0'),
  notes: text('notes'),
});

export const bomOperations = erp.table('bom_operations', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  bomId: uuid('bom_id').notNull(),
  opNo: integer('op_no').notNull(),
  name: text('name').notNull(),
  workCentreId: uuid('work_centre_id').notNull(),
  setupHours: numeric('setup_hours', { precision: 12, scale: 4 }).notNull().default('0'),
  runHours: numeric('run_hours', { precision: 12, scale: 4 }).notNull().default('0'),
});

export const manufacturingSettings = erp.table('manufacturing_settings', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  wipAccountId: uuid('wip_account_id'),
  labourAbsorbedAccountId: uuid('labour_absorbed_account_id'),
  overheadAbsorbedAccountId: uuid('overhead_absorbed_account_id'),
  productionVarianceAccountId: uuid('production_variance_account_id'),
  subcontractClearingAccountId: uuid('subcontract_clearing_account_id'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const workOrders = erp.table('work_orders', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  woNo: text('wo_no').notNull(),
  itemId: uuid('item_id').notNull(),
  bomId: uuid('bom_id').notNull(),
  plannedQuantity: quantity('planned_quantity').notNull(),
  producedQuantity: quantity('produced_quantity').notNull().default('0'),
  scrapQuantity: quantity('scrap_quantity').notNull().default('0'),
  outputWarehouseId: uuid('output_warehouse_id').notNull(),
  materialsWarehouseId: uuid('materials_warehouse_id').notNull(),
  plannedStart: day('planned_start'),
  dueDate: day('due_date'),
  notes: text('notes'),
  status: text('status').notNull().default('planned'),
  releasedAt: ts('released_at'),
  completedAt: ts('completed_at'),
  cancelledAt: ts('cancelled_at'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const workOrderMaterials = erp.table('work_order_materials', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  workOrderId: uuid('work_order_id').notNull(),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id').notNull(),
  requiredQuantity: quantity('required_quantity').notNull(),
  issuedQuantity: quantity('issued_quantity').notNull().default('0'),
  returnedQuantity: quantity('returned_quantity').notNull().default('0'),
});

export const workOrderOperations = erp.table('work_order_operations', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  workOrderId: uuid('work_order_id').notNull(),
  opNo: integer('op_no').notNull(),
  name: text('name').notNull(),
  workCentreId: uuid('work_centre_id').notNull(),
  plannedHours: numeric('planned_hours', { precision: 12, scale: 4 }).notNull(),
  actualHours: numeric('actual_hours', { precision: 12, scale: 4 }).notNull().default('0'),
});

export const workOrderTransactions = erp.table('work_order_transactions', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  workOrderId: uuid('work_order_id').notNull(),
  companyId: uuid('company_id').notNull(),
  kind: text('kind').notNull(),
  txnDate: day('txn_date').notNull(),
  itemId: uuid('item_id'),
  operationId: uuid('operation_id'),
  quantity: quantity('quantity'),
  hours: numeric('hours', { precision: 12, scale: 4 }),
  value: money('value').notNull(),
  stockMovementId: uuid('stock_movement_id'),
  journalEntryIds: uuid('journal_entry_ids').array().notNull().default([]),
  note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const subcontractOrders = erp.table('subcontract_orders', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  workOrderId: uuid('work_order_id').notNull(),
  subcontractorId: uuid('subcontractor_id').notNull(),
  jobworkerWarehouseId: uuid('jobworker_warehouse_id').notNull(),
  sourceWarehouseId: uuid('source_warehouse_id').notNull(),
  ratePerUnit: money('rate_per_unit').notNull(),
  firstSentOn: day('first_sent_on'),
  returnDueDate: day('return_due_date'),
  status: text('status').notNull().default('open'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const subcontractChallans = erp.table('subcontract_challans', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  orderId: uuid('order_id').notNull(),
  challanNo: text('challan_no').notNull(),
  kind: text('kind').notNull(),
  challanDate: day('challan_date').notNull(),
  vehicleNo: text('vehicle_no'),
  ewayBillNo: text('eway_bill_no'),
  stockMovementId: uuid('stock_movement_id').notNull(),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const subcontractChallanLines = erp.table('subcontract_challan_lines', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  challanId: uuid('challan_id').notNull(),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id').notNull(),
  quantity: quantity('quantity').notNull(),
  batchId: uuid('batch_id'),
  serialNos: text('serial_nos').array(),
});
