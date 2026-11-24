import { integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0045_einvoice_eway.sql. */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const einvoiceRecords = erp.table('einvoice_records', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), companyId: uuid('company_id').notNull(), invoiceId: uuid('invoice_id').notNull(),
  irn: text('irn').notNull(), ackNo: text('ack_no').notNull(), ackDate: ts('ack_date').notNull(), signedQr: text('signed_qr').notNull(), signedInvoice: text('signed_invoice'),
  status: text('status').notNull().default('active'), cancelledAt: ts('cancelled_at'), cancelReason: text('cancel_reason'), createdBy: uuid('created_by'), createdAt: ts('created_at').notNull().defaultNow(),
});
export const ewayBills = erp.table('eway_bills', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), companyId: uuid('company_id').notNull(), invoiceId: uuid('invoice_id').notNull(),
  billNo: text('bill_no').notNull(), billDate: ts('bill_date').notNull(), validUntil: ts('valid_until'), transportMode: text('transport_mode').notNull().default('road'), distanceKm: integer('distance_km'),
  vehicleNo: text('vehicle_no'), transporterId: text('transporter_id'), transporterName: text('transporter_name'), transDocNo: text('trans_doc_no'),
  status: text('status').notNull().default('active'), cancelledAt: ts('cancelled_at'), createdBy: uuid('created_by'), createdAt: ts('created_at').notNull().defaultNow(),
});
