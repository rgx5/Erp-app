import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { accounts } from '../accounting/accounting.schema.js';
import { fromUnits, toUnits } from '../accounting/money.js';
import { PostingService } from '../accounting/posting.service.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { parties } from '../masterdata/masterdata.schema.js';
import { nextDocNumber } from '../sales/doc-number.js';
import { payableAllocations, supplierBills, supplierPayments, supplierRefunds } from './purchasing.schema.js';
import type { CreatePaymentInput, SupplierRefundInput } from './purchasing.schemas.js';
import { PurchasingSettingsService } from './purchasing-settings.service.js';
import { SupplierBillsService } from './supplier-bills.service.js';

export type PaymentRow = typeof supplierPayments.$inferSelect;
export type PayableAllocationRow = typeof payableAllocations.$inferSelect;
type BillRow = typeof supplierBills.$inferSelect;
type Source = { type: 'payment'; row: PaymentRow } | { type: 'debit_note'; row: BillRow };

const signed = (text: string): bigint => (text.startsWith('-') ? -toUnits(text.slice(1)) : toUnits(text));
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Supplier payments and who is owed what. The payable is the general ledger (payables control account, supplier as the dimension);
 * payments and debit notes are *allocated* to bills here, and the database refuses to settle more than a bill is worth or than a
 * source holds. Reports (position, statement, ageing) are computed as of any date from immutable documents and the allocation
 * history, and the reconciliation proves they agree with the ledger supplier by supplier. The mirror of customer receivables.
 */
@Injectable()
export class PayablesService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(PurchasingSettingsService) private readonly settings: PurchasingSettingsService,
    @Inject(SupplierBillsService) private readonly bills: SupplierBillsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {
    // A bill with money allocated to it cannot be cancelled: release the allocations first.
    this.bills.onCancel(async (tx, tenantId, bill) => {
      const [a] = await tx.select({ id: payableAllocations.id }).from(payableAllocations).where(and(eq(payableAllocations.tenantId, tenantId), eq(payableAllocations.billId, bill.id), sql`${payableAllocations.reversedAt} IS NULL`)).limit(1);
      if (a) throw new AppError(409, 'has_settlements', 'Money is allocated to this bill; reverse the allocations first');
    });
  }

  // ---- payments -----------------------------------------------------------------------------------------------------
  createPayment(tenantId: string, actorId: string, input: CreatePaymentInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const supplier = await this.requireSupplier(tx, tenantId, input.supplierId);
      await this.requireCashAccount(tx, tenantId, input.companyId, input.paidFromAccountId, 'paidFromAccountId');
      const settings = await this.settings.require(tx, tenantId, input.companyId, ['payableAccountId']);
      const paymentNo = await nextDocNumber(tx, tenantId, input.companyId, input.paymentDate, 'PAY');
      const id = uuidv7();
      const { entry } = await this.posting.post(tx, tenantId, {
        companyId: input.companyId, postingDate: input.paymentDate, journalType: 'system', description: `Payment ${paymentNo} to ${supplier.tradeName ?? supplier.legalName}`,
        lines: [{ accountId: settings.payableAccountId as string, debit: input.amount, partyId: supplier.id, description: paymentNo }, { accountId: input.paidFromAccountId, credit: input.amount, description: paymentNo }],
        source: { type: 'supplier_payment', id, event: 'post' }, postedBy: actorId,
      });
      const payment = first(
        await tx.insert(supplierPayments).values({ tenantId, id, companyId: input.companyId, paymentNo, supplierId: supplier.id, paymentDate: input.paymentDate, amount: input.amount, method: input.method, paidFromAccountId: input.paidFromAccountId, reference: input.reference ?? null, notes: input.notes ?? null, journalEntryId: entry.id, createdBy: actorId }).returning(),
        'Payment',
      );
      if (input.allocations && input.allocations.length > 0) await this.apply(tx, tenantId, actorId, { companyId: input.companyId, supplierId: supplier.id, source: { type: 'payment', row: payment }, allocatedOn: input.paymentDate, items: input.allocations });
      await this.recorder.record(tx, tenantId, 'supplier_payment', 'posted', payment, { paymentNo, supplierId: supplier.id, amount: payment.amount });
      return this.readPayment(tx, tenantId, id);
    });
  }

  /** Cancels a payment (a bounced cheque): reverses its journal and releases whatever it settled. */
  cancelPayment(tenantId: string, actorId: string, id: string, input: { cancelDate: string; reason: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const payment = first(await tx.select().from(supplierPayments).where(and(eq(supplierPayments.tenantId, tenantId), eq(supplierPayments.id, id))).for('update'), 'Payment');
      if (payment.status !== 'posted') throw new AppError(409, 'already_cancelled', 'This payment is already cancelled');
      if (input.cancelDate < payment.paymentDate) throw validationFailed([{ path: 'cancelDate', message: 'Cannot be before the payment date' }]);
      const [refunded] = await tx.select({ n: supplierRefunds.refundNo }).from(supplierRefunds).where(and(eq(supplierRefunds.tenantId, tenantId), eq(supplierRefunds.paymentId, id))).limit(1);
      if (refunded) throw new AppError(409, 'has_refunds', `Refund ${refunded.n} was received out of this payment`);
      let reversal: string | null = null;
      if (payment.journalEntryId) reversal = (await this.posting.reverse(tx, tenantId, payment.journalEntryId, { postingDate: input.cancelDate, reason: `Cancelled: ${input.reason}`, postedBy: actorId, allowSystem: true })).entry.id;
      await tx.update(payableAllocations).set({ reversedOn: input.cancelDate, reversedAt: new Date() }).where(and(eq(payableAllocations.tenantId, tenantId), eq(payableAllocations.paymentId, id), sql`${payableAllocations.reversedAt} IS NULL`));
      const updated = first(await tx.update(supplierPayments).set({ status: 'cancelled', cancelledAt: new Date(), cancelDate: input.cancelDate, cancelReason: input.reason, cancelJournalEntryId: reversal }).where(and(eq(supplierPayments.tenantId, tenantId), eq(supplierPayments.id, id))).returning(), 'Payment');
      await this.recorder.record(tx, tenantId, 'supplier_payment', 'cancelled', updated, { paymentNo: updated.paymentNo, reason: input.reason });
      return this.readPayment(tx, tenantId, id);
    });
  }

  // ---- refunds from suppliers -------------------------------------------------------------------------------------
  /** Money the supplier sends back out of an unallocated advance or an unapplied debit note: Dr bank, Cr payables (supplier). */
  refund(tenantId: string, actorId: string, input: SupplierRefundInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const source = await this.lockSource(tx, tenantId, input.source);
      const supplierId = source.row.supplierId;
      if (source.row.companyId !== input.companyId) throw validationFailed([{ path: 'companyId', message: 'The source belongs to a different company' }]);
      const sourceDate = source.type === 'payment' ? source.row.paymentDate : source.row.billDate;
      if (input.refundDate < sourceDate) throw validationFailed([{ path: 'refundDate', message: 'Cannot be before the payment or debit note date' }]);
      const available = await this.unapplied(tx, tenantId, source);
      if (toUnits(input.amount) > available) throw new AppError(409, 'exceeds_available', `Only ${fromUnits(available)} is unallocated and can be refunded`, { available: fromUnits(available) });
      await this.requireCashAccount(tx, tenantId, input.companyId, input.depositAccountId, 'depositAccountId');
      const settings = await this.settings.require(tx, tenantId, input.companyId, ['payableAccountId']);
      const refundNo = await nextDocNumber(tx, tenantId, input.companyId, input.refundDate, 'SRF');
      const id = uuidv7();
      const { entry } = await this.posting.post(tx, tenantId, {
        companyId: input.companyId, postingDate: input.refundDate, journalType: 'system', description: `Supplier refund ${refundNo}`,
        lines: [{ accountId: input.depositAccountId, debit: input.amount, description: refundNo }, { accountId: settings.payableAccountId as string, credit: input.amount, partyId: supplierId, description: refundNo }],
        source: { type: 'supplier_refund', id, event: 'post' }, postedBy: actorId,
      });
      const row = first(
        await tx.insert(supplierRefunds).values({ tenantId, id, companyId: input.companyId, refundNo, supplierId, refundDate: input.refundDate, amount: input.amount, method: input.method, depositAccountId: input.depositAccountId, ...(source.type === 'payment' ? { paymentId: source.row.id } : { debitNoteId: source.row.id }), reference: input.reference ?? null, journalEntryId: entry.id, createdBy: actorId }).returning(),
        'Refund',
      );
      await this.recorder.record(tx, tenantId, 'supplier_refund', 'posted', row, { refundNo, supplierId, amount: input.amount, source: input.source.type });
      return row;
    });
  }

  // ---- allocations ------------------------------------------------------------------------------------------------
  /** Settles bills from a payment or a debit note. */
  allocate(tenantId: string, actorId: string, input: { source: { type: 'payment' | 'debit_note'; id: string }; allocatedOn: string; allocations: { billId: string; amount: string }[] }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const source = await this.lockSource(tx, tenantId, input.source);
      return this.apply(tx, tenantId, actorId, { companyId: source.row.companyId, supplierId: source.row.supplierId, source, allocatedOn: input.allocatedOn, items: input.allocations });
    });
  }

  reverseAllocation(tenantId: string, id: string, input: { on: string; reason: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const a = first(await tx.select().from(payableAllocations).where(and(eq(payableAllocations.tenantId, tenantId), eq(payableAllocations.id, id))).for('update'), 'Allocation');
      if (a.reversedAt) throw new AppError(409, 'already_reversed', 'This allocation was already reversed');
      if (input.on < a.allocatedOn) throw validationFailed([{ path: 'on', message: 'Cannot be before the allocation date' }]);
      const updated = first(await tx.update(payableAllocations).set({ reversedOn: input.on, reversedAt: new Date() }).where(and(eq(payableAllocations.tenantId, tenantId), eq(payableAllocations.id, id))).returning(), 'Allocation');
      await this.recorder.record(tx, tenantId, 'payable_allocation', 'reversed', updated, { reason: input.reason, amount: updated.amount });
      return updated;
    });
  }

  private async lockSource(tx: Tx, tenantId: string, ref: { type: 'payment' | 'debit_note'; id: string }): Promise<Source> {
    if (ref.type === 'payment') {
      const row = first(await tx.select().from(supplierPayments).where(and(eq(supplierPayments.tenantId, tenantId), eq(supplierPayments.id, ref.id))).for('update'), 'Payment');
      if (row.status !== 'posted') throw new AppError(409, 'payment_cancelled', 'This payment was cancelled');
      return { type: 'payment', row };
    }
    const row = first(await tx.select().from(supplierBills).where(and(eq(supplierBills.tenantId, tenantId), eq(supplierBills.id, ref.id))).for('update'), 'Debit note');
    if (row.documentType !== 'debit_note') throw new AppError(422, 'not_a_debit_note', 'The source must be a debit note');
    return { type: 'debit_note', row };
  }

  /** What a payment or debit note still holds: its value less active allocations and refunds. */
  private async unapplied(tx: Tx, tenantId: string, source: Source): Promise<bigint> {
    const held = toUnits(source.type === 'payment' ? source.row.amount : source.row.grandTotal);
    const isPayment = source.type === 'payment';
    const [alloc] = await tx.select({ s: sql<string>`COALESCE(SUM(${payableAllocations.amount}), 0)::text` }).from(payableAllocations).where(and(eq(payableAllocations.tenantId, tenantId), isPayment ? eq(payableAllocations.paymentId, source.row.id) : eq(payableAllocations.debitNoteId, source.row.id), sql`${payableAllocations.reversedAt} IS NULL`));
    const [refunded] = await tx.select({ s: sql<string>`COALESCE(SUM(${supplierRefunds.amount}), 0)::text` }).from(supplierRefunds).where(and(eq(supplierRefunds.tenantId, tenantId), isPayment ? eq(supplierRefunds.paymentId, source.row.id) : eq(supplierRefunds.debitNoteId, source.row.id)));
    return held - toUnits(alloc?.s ?? '0') - toUnits(refunded?.s ?? '0');
  }

  private async outstanding(tx: Tx, tenantId: string, bill: BillRow): Promise<bigint> {
    const [r] = await tx.select({ s: sql<string>`COALESCE(SUM(${payableAllocations.amount}), 0)::text` }).from(payableAllocations).where(and(eq(payableAllocations.tenantId, tenantId), eq(payableAllocations.billId, bill.id), sql`${payableAllocations.reversedAt} IS NULL`));
    return toUnits(bill.grandTotal) - toUnits(r?.s ?? '0');
  }

  private assertSettleable(bill: BillRow): void {
    if (bill.documentType !== 'bill') throw new AppError(422, 'not_settleable', 'Only bills are settled');
    if (bill.status !== 'posted') throw new AppError(409, 'bill_cancelled', `${bill.billNo} was cancelled`);
  }

  private async apply(tx: Tx, tenantId: string, actorId: string, p: { companyId: string; supplierId: string; source: Source; allocatedOn: string; items: { billId: string; amount: string }[] }): Promise<PayableAllocationRow[]> {
    const sourceDate = p.source.type === 'payment' ? p.source.row.paymentDate : p.source.row.billDate;
    let available = await this.unapplied(tx, tenantId, p.source);
    const byBill = new Map<string, bigint>();
    for (const it of p.items) byBill.set(it.billId, (byBill.get(it.billId) ?? 0n) + toUnits(it.amount));
    const rows: PayableAllocationRow[] = [];
    for (const billId of [...byBill.keys()].sort()) { // fixed lock order
      const bill = first(await tx.select().from(supplierBills).where(and(eq(supplierBills.tenantId, tenantId), eq(supplierBills.id, billId))).for('update'), 'Bill');
      if (bill.supplierId !== p.supplierId) throw validationFailed([{ path: 'allocations', message: `${bill.billNo} belongs to a different supplier` }]);
      this.assertSettleable(bill);
      if (p.allocatedOn < bill.billDate || p.allocatedOn < sourceDate) throw validationFailed([{ path: 'allocatedOn', message: 'Cannot be before the bill or the payment/debit note date' }]);
      const amount = byBill.get(billId) as bigint;
      const outstanding = await this.outstanding(tx, tenantId, bill);
      if (amount > outstanding) throw new AppError(409, 'exceeds_outstanding', `Only ${fromUnits(outstanding)} is outstanding on ${bill.billNo}`, { billId, outstanding: fromUnits(outstanding) });
      if (amount > available) throw new AppError(409, 'exceeds_available', `Only ${fromUnits(available)} of this ${p.source.type === 'payment' ? 'payment' : 'debit note'} is unallocated`, { available: fromUnits(available) });
      available -= amount;
      rows.push(first(await tx.insert(payableAllocations).values({ tenantId, id: uuidv7(), companyId: p.companyId, supplierId: p.supplierId, billId, ...(p.source.type === 'payment' ? { paymentId: p.source.row.id } : { debitNoteId: p.source.row.id }), amount: fromUnits(amount), allocatedOn: p.allocatedOn, createdBy: actorId }).returning(), 'Allocation'));
    }
    for (const r of rows) await this.recorder.record(tx, tenantId, 'payable_allocation', 'created', r, { billId: r.billId, amount: r.amount, source: p.source.type });
    return rows;
  }

  private async requireSupplier(tx: Tx, tenantId: string, supplierId: string) {
    const supplier = first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, supplierId))), 'Supplier');
    if (!supplier.isSupplier) throw new AppError(422, 'not_a_supplier', `${supplier.code} is not a supplier`);
    return supplier;
  }

  private async requireCashAccount(tx: Tx, tenantId: string, companyId: string, accountId: string, path: string): Promise<void> {
    const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, accountId)));
    if (!a || a.type !== 'asset' || a.isGroup || a.status !== 'active' || a.controlKind) throw validationFailed([{ path, message: 'Must be an active cash or bank (non-control asset) account of this company' }]);
  }

  // ---- reads ------------------------------------------------------------------------------------------------------
  getPayment(tenantId: string, id: string) { return this.uow.inTenant(tenantId, (tx) => this.readPayment(tx, tenantId, id), { readOnly: true }); }
  private async readPayment(tx: Tx, tenantId: string, id: string) {
    const payment = first(await tx.select().from(supplierPayments).where(and(eq(supplierPayments.tenantId, tenantId), eq(supplierPayments.id, id))), 'Payment');
    const allocations = await tx.select().from(payableAllocations).where(and(eq(payableAllocations.tenantId, tenantId), eq(payableAllocations.paymentId, id))).orderBy(asc(payableAllocations.id));
    const allocated = allocations.filter((a) => !a.reversedAt).reduce((s, a) => s + toUnits(a.amount), 0n);
    const [refunded] = await tx.select({ s: sql<string>`COALESCE(SUM(${supplierRefunds.amount}), 0)::text` }).from(supplierRefunds).where(and(eq(supplierRefunds.tenantId, tenantId), eq(supplierRefunds.paymentId, id)));
    return { payment, allocations, unallocated: payment.status === 'posted' ? fromUnits(toUnits(payment.amount) - allocated - toUnits(refunded?.s ?? '0')) : '0.0000' };
  }
  listPayments(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; supplierId?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(supplierPayments).where(and(eq(supplierPayments.tenantId, tenantId), eq(supplierPayments.companyId, q.companyId), before ? lt(supplierPayments.id, before) : undefined, q.supplierId ? eq(supplierPayments.supplierId, q.supplierId) : undefined, q.status ? eq(supplierPayments.status, q.status) : undefined)).orderBy(desc(supplierPayments.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }

  /** Open bills and unapplied payments/debit notes as of a date, optionally for one supplier. */
  private async openItems(tx: Tx, tenantId: string, companyId: string, asOf: string, supplierId?: string) {
    const sup = supplierId ? sql`AND b.supplier_id = ${supplierId}::uuid` : sql``;
    const bills = await tx.execute<{ id: string; bill_no: string; supplier_invoice_no: string; bill_date: string; due_date: string; supplier_id: string; supplier_name: string; grand_total: string; outstanding: string }>(sql`
      SELECT b.id, b.bill_no, b.supplier_invoice_no, b.bill_date::text, b.due_date::text, b.supplier_id, b.supplier_name, b.grand_total::text,
             (b.grand_total - COALESCE((SELECT SUM(a.amount) FROM erp.payable_allocations a WHERE a.tenant_id = b.tenant_id AND a.bill_id = b.id AND a.allocated_on <= ${asOf}::date AND (a.reversed_on IS NULL OR a.reversed_on > ${asOf}::date)), 0))::text AS outstanding
        FROM erp.supplier_bills b
       WHERE b.tenant_id = ${tenantId}::uuid AND b.company_id = ${companyId}::uuid AND b.document_type = 'bill' AND b.bill_date <= ${asOf}::date
         AND (b.status = 'posted' OR b.cancel_date > ${asOf}::date) ${sup}
       ORDER BY b.bill_date, b.bill_no`);
    const unapplied = await tx.execute<{ kind: string; id: string; number: string; date: string; supplier_id: string; unapplied: string }>(sql`
      SELECT 'payment' AS kind, p.id, p.payment_no AS number, p.payment_date::text AS date, p.supplier_id,
             (p.amount - COALESCE((SELECT SUM(a.amount) FROM erp.payable_allocations a WHERE a.tenant_id = p.tenant_id AND a.payment_id = p.id AND a.allocated_on <= ${asOf}::date AND (a.reversed_on IS NULL OR a.reversed_on > ${asOf}::date)), 0)
                       - COALESCE((SELECT SUM(f.amount) FROM erp.supplier_refunds f WHERE f.tenant_id = p.tenant_id AND f.payment_id = p.id AND f.refund_date <= ${asOf}::date), 0))::text AS unapplied
        FROM erp.supplier_payments p
       WHERE p.tenant_id = ${tenantId}::uuid AND p.company_id = ${companyId}::uuid AND p.payment_date <= ${asOf}::date AND (p.status = 'posted' OR p.cancel_date > ${asOf}::date) ${supplierId ? sql`AND p.supplier_id = ${supplierId}::uuid` : sql``}
      UNION ALL
      SELECT 'debit_note', b.id, b.bill_no, b.bill_date::text, b.supplier_id,
             (b.grand_total - COALESCE((SELECT SUM(a.amount) FROM erp.payable_allocations a WHERE a.tenant_id = b.tenant_id AND a.debit_note_id = b.id AND a.allocated_on <= ${asOf}::date AND (a.reversed_on IS NULL OR a.reversed_on > ${asOf}::date)), 0)
                       - COALESCE((SELECT SUM(f.amount) FROM erp.supplier_refunds f WHERE f.tenant_id = b.tenant_id AND f.debit_note_id = b.id AND f.refund_date <= ${asOf}::date), 0))::text
        FROM erp.supplier_bills b
       WHERE b.tenant_id = ${tenantId}::uuid AND b.company_id = ${companyId}::uuid AND b.document_type = 'debit_note' AND b.bill_date <= ${asOf}::date AND b.status = 'posted' ${sup}`);
    return { bills: bills.rows.filter((r) => signed(r.outstanding) > 0n), unapplied: unapplied.rows.filter((r) => signed(r.unapplied) > 0n) };
  }

  /** What we owe a supplier: open bills, payments and debit notes not yet applied, and the net balance (positive: we owe them). */
  position(tenantId: string, companyId: string, supplierId: string, asOf: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const supplier = first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, supplierId))), 'Supplier');
      const { bills, unapplied } = await this.openItems(tx, tenantId, companyId, asOf, supplierId);
      const owed = bills.reduce((s, r) => s + signed(r.outstanding), 0n);
      const credits = unapplied.reduce((s, r) => s + signed(r.unapplied), 0n);
      return {
        supplier: { id: supplier.id, code: supplier.code, name: supplier.tradeName ?? supplier.legalName }, asOf,
        openBills: bills.map((r) => ({ id: r.id, number: r.bill_no, supplierInvoiceNo: r.supplier_invoice_no, date: r.bill_date, dueDate: r.due_date, total: r.grand_total, outstanding: r.outstanding, daysOverdue: Math.max(0, daysBetween(r.due_date, asOf)) })),
        unapplied: unapplied.map((r) => ({ kind: r.kind, id: r.id, number: r.number, date: r.date, amount: r.unapplied })),
        totalOutstanding: fromUnits(owed), totalUnapplied: fromUnits(credits), balance: fromUnits(owed - credits),
      };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  /** Payables ageing by days past due: current, 1-30, 31-60, 61-90, over 90 (unapplied credits shown separately). */
  ageing(tenantId: string, companyId: string, asOf: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const { bills, unapplied } = await this.openItems(tx, tenantId, companyId, asOf);
      const keys = ['current', 'days1to30', 'days31to60', 'days61to90', 'over90'] as const;
      const bucketOf = (days: number) => (days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4);
      const bySupplier = new Map<string, { supplierId: string; supplierName: string; buckets: bigint[]; unapplied: bigint }>();
      const row = (id: string, name: string) => {
        let r = bySupplier.get(id);
        if (!r) bySupplier.set(id, (r = { supplierId: id, supplierName: name, buckets: [0n, 0n, 0n, 0n, 0n], unapplied: 0n }));
        return r;
      };
      for (const b of bills) row(b.supplier_id, b.supplier_name).buckets[bucketOf(daysBetween(b.due_date, asOf))]! += signed(b.outstanding);
      const names = new Map(bills.map((b) => [b.supplier_id, b.supplier_name]));
      for (const u of unapplied) {
        let name = names.get(u.supplier_id);
        if (!name) name = (await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, u.supplier_id))).then((r) => r[0]?.tradeName ?? r[0]?.legalName)) ?? '';
        row(u.supplier_id, name).unapplied += signed(u.unapplied);
      }
      const all = [...bySupplier.values()];
      const out = all.sort((a, b) => a.supplierName.localeCompare(b.supplierName)).map((r) => ({
        supplierId: r.supplierId, supplierName: r.supplierName, ...Object.fromEntries(keys.map((k, n) => [k, fromUnits(r.buckets[n] as bigint)])), total: fromUnits(r.buckets.reduce((a, b) => a + b, 0n)), unapplied: fromUnits(r.unapplied),
      }));
      const totals = Object.fromEntries(keys.map((k, n) => [k, fromUnits(all.reduce((s, r) => s + (r.buckets[n] as bigint), 0n))]));
      return { asOf, suppliers: out, totals: { ...totals, total: fromUnits(all.reduce((s, r) => s + r.buckets.reduce((a, b) => a + b, 0n), 0n)), unapplied: fromUnits(all.reduce((s, r) => s + r.unapplied, 0n)) } };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  /** A supplier's statement: every movement in the period with a running balance (positive: we owe them), from the opening balance. */
  statement(tenantId: string, companyId: string, supplierId: string, from: string, to: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const supplier = first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, supplierId))), 'Supplier');
      const res = await tx.execute<{ date: string; kind: string; number: string; debit: string; credit: string; ord: string }>(sql`
        SELECT * FROM (
          SELECT b.bill_date::text AS date, b.document_type AS kind, b.bill_no AS number, CASE WHEN b.document_type = 'debit_note' THEN b.grand_total ELSE 0 END::text AS debit, CASE WHEN b.document_type = 'debit_note' THEN 0 ELSE b.grand_total END::text AS credit, b.id::text AS ord
            FROM erp.supplier_bills b WHERE b.tenant_id = ${tenantId}::uuid AND b.company_id = ${companyId}::uuid AND b.supplier_id = ${supplierId}::uuid AND b.bill_date <= ${to}::date
          UNION ALL
          SELECT b.cancel_date::text, 'cancellation', b.bill_no, b.grand_total::text, '0', b.id::text || 'c' FROM erp.supplier_bills b
           WHERE b.tenant_id = ${tenantId}::uuid AND b.company_id = ${companyId}::uuid AND b.supplier_id = ${supplierId}::uuid AND b.status = 'cancelled' AND b.cancel_date <= ${to}::date
          UNION ALL
          SELECT p.payment_date::text, 'payment', p.payment_no, p.amount::text, '0', p.id::text FROM erp.supplier_payments p
           WHERE p.tenant_id = ${tenantId}::uuid AND p.company_id = ${companyId}::uuid AND p.supplier_id = ${supplierId}::uuid AND p.payment_date <= ${to}::date
          UNION ALL
          SELECT p.cancel_date::text, 'payment_cancelled', p.payment_no, '0', p.amount::text, p.id::text || 'c' FROM erp.supplier_payments p
           WHERE p.tenant_id = ${tenantId}::uuid AND p.company_id = ${companyId}::uuid AND p.supplier_id = ${supplierId}::uuid AND p.status = 'cancelled' AND p.cancel_date <= ${to}::date
          UNION ALL
          SELECT f.refund_date::text, 'refund', f.refund_no, '0', f.amount::text, f.id::text FROM erp.supplier_refunds f
           WHERE f.tenant_id = ${tenantId}::uuid AND f.company_id = ${companyId}::uuid AND f.supplier_id = ${supplierId}::uuid AND f.refund_date <= ${to}::date
        ) m ORDER BY date, ord`);
      let balance = 0n;
      let opening = 0n;
      const lines = [];
      for (const m of res.rows) {
        const delta = toUnits(m.credit) - toUnits(m.debit); // we owe: credits raise it
        balance += delta;
        if (m.date < from) { opening += delta; continue; }
        lines.push({ date: m.date, kind: m.kind, number: m.number, debit: fromUnits(toUnits(m.debit)), credit: fromUnits(toUnits(m.credit)), balance: fromUnits(balance) });
      }
      return { supplier: { id: supplier.id, code: supplier.code, name: supplier.tradeName ?? supplier.legalName }, from, to, openingBalance: fromUnits(opening), lines, closingBalance: fromUnits(balance) };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  /**
   * Proves the payables documents and the general ledger agree, supplier by supplier: bills less debit notes less payments plus
   * refunds received (as of the date, honouring cancellations) against the supplier's balance on the payables control account.
   */
  reconciliation(tenantId: string, companyId: string, asOf: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const settings = await this.settings.require(tx, tenantId, companyId, ['payableAccountId']);
      const res = await tx.execute<{ supplier_id: string | null; name: string | null; documents: string; ledger: string }>(sql`
        WITH docs AS (
          SELECT supplier_id, SUM(CASE WHEN document_type = 'debit_note' THEN -grand_total ELSE grand_total END) AS v FROM erp.supplier_bills
           WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND bill_date <= ${asOf}::date AND (status = 'posted' OR cancel_date > ${asOf}::date) GROUP BY supplier_id),
        pay AS (
          SELECT supplier_id, SUM(amount) AS v FROM erp.supplier_payments
           WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND payment_date <= ${asOf}::date AND (status = 'posted' OR cancel_date > ${asOf}::date) GROUP BY supplier_id),
        refunds AS (
          SELECT supplier_id, SUM(amount) AS v FROM erp.supplier_refunds
           WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND refund_date <= ${asOf}::date GROUP BY supplier_id),
        gl AS (
          SELECT party_id AS supplier_id, SUM(credit - debit) AS v FROM erp.journal_lines
           WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND account_id = ${settings.payableAccountId}::uuid AND posting_date <= ${asOf}::date GROUP BY party_id),
        ids AS (SELECT supplier_id FROM docs UNION SELECT supplier_id FROM pay UNION SELECT supplier_id FROM refunds UNION SELECT supplier_id FROM gl)
        SELECT ids.supplier_id, COALESCE(p.trade_name, p.legal_name) AS name,
               (COALESCE(docs.v, 0) - COALESCE(pay.v, 0) + COALESCE(refunds.v, 0))::text AS documents, COALESCE(gl.v, 0)::text AS ledger
          FROM ids LEFT JOIN docs USING (supplier_id) LEFT JOIN pay USING (supplier_id) LEFT JOIN refunds USING (supplier_id) LEFT JOIN gl USING (supplier_id)
          LEFT JOIN erp.parties p ON p.tenant_id = ${tenantId}::uuid AND p.id = ids.supplier_id
         ORDER BY name NULLS LAST`);
      let documentsTotal = 0n;
      let ledgerTotal = 0n;
      const rows = res.rows.map((r) => {
        const d = signed(r.documents);
        const l = signed(r.ledger);
        documentsTotal += d;
        ledgerTotal += l;
        return { supplierId: r.supplier_id, supplierName: r.name ?? '(no supplier on the ledger line)', documents: fromUnits(d), ledger: fromUnits(l), difference: fromUnits(l - d), reconciled: d === l };
      });
      return { companyId, asOf, rows, documentsTotal: fromUnits(documentsTotal), ledgerTotal: fromUnits(ledgerTotal), difference: fromUnits(ledgerTotal - documentsTotal), reconciled: rows.every((r) => r.reconciled) };
    }, { readOnly: true, isolation: 'repeatable read' });
  }
}
