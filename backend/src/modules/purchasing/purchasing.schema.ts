import { date, integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0013_purchasing_orders.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const quantity = (name: string) => numeric(name, { precision: 18, scale: 6 });
const rate = (name: string) => numeric(name, { precision: 7, scale: 4 });

export const purchasingSettings = erp.table('purchasing_settings', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  payableAccountId: uuid('payable_account_id'),
  grniAccountId: uuid('grni_account_id'),
  purchasePriceVarianceAccountId: uuid('purchase_price_variance_account_id'),
  expensePurchaseAccountId: uuid('expense_purchase_account_id'),
  roundOffAccountId: uuid('round_off_account_id'),
  inputCgstAccountId: uuid('input_cgst_account_id'),
  inputSgstAccountId: uuid('input_sgst_account_id'),
  inputIgstAccountId: uuid('input_igst_account_id'),
  inputCessAccountId: uuid('input_cess_account_id'),
  rcmCgstAccountId: uuid('rcm_cgst_account_id'),
  rcmSgstAccountId: uuid('rcm_sgst_account_id'),
  rcmIgstAccountId: uuid('rcm_igst_account_id'),
  rcmCessAccountId: uuid('rcm_cess_account_id'),
  freightAccountId: uuid('freight_account_id'),
  priceTolerancePercent: rate('price_tolerance_percent').notNull().default('0'),
  quantityTolerancePercent: rate('quantity_tolerance_percent').notNull().default('0'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const purchaseOrders = erp.table('purchase_orders', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  poNo: text('po_no').notNull(),
  gstRegistrationId: uuid('gst_registration_id').notNull(),
  businessLocationId: uuid('business_location_id'),
  supplierId: uuid('supplier_id').notNull(),
  orderDate: day('order_date').notNull(),
  expectedDate: day('expected_date'),
  supplierReference: text('supplier_reference'),
  notes: text('notes'),
  status: text('status').notNull().default('open'),
  closedAt: ts('closed_at'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const purchaseOrderLines = erp.table('purchase_order_lines', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  orderId: uuid('order_id').notNull(),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id').notNull(),
  description: text('description').notNull(),
  quantity: quantity('quantity').notNull(),
  quantityReceived: quantity('quantity_received').notNull().default('0'),
  quantityBilled: quantity('quantity_billed').notNull().default('0'),
  unitPrice: money('unit_price').notNull(),
  discountPercent: rate('discount_percent').notNull().default('0'),
  taxCodeId: uuid('tax_code_id'),
  warehouseId: uuid('warehouse_id'),
});

export const goodsReceipts = erp.table('goods_receipts', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  grnNo: text('grn_no').notNull(),
  purchaseOrderId: uuid('purchase_order_id'),
  supplierId: uuid('supplier_id').notNull(),
  receiptDate: day('receipt_date').notNull(),
  supplierDeliveryNote: text('supplier_delivery_note'),
  notes: text('notes'),
  stockMovementId: uuid('stock_movement_id').notNull(),
  status: text('status').notNull().default('posted'),
  receivedBy: uuid('received_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const goodsReceiptLines = erp.table('goods_receipt_lines', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  receiptId: uuid('receipt_id').notNull(),
  lineNo: integer('line_no').notNull(),
  orderLineId: uuid('order_line_id'),
  itemId: uuid('item_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  quantity: quantity('quantity').notNull(),
  quantityBilled: quantity('quantity_billed').notNull().default('0'),
  quantityReturned: quantity('quantity_returned').notNull().default('0'),
  unitCost: numeric('unit_cost', { precision: 18, scale: 6 }).notNull(),
  value: money('value').notNull(),
  batchId: uuid('batch_id'),
  serialNos: text('serial_nos').array(),
});

