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
import { nextDocNumber } from './doc-number.js';
import { customerReceipts, customerRefunds, receivableAllocations, salesInvoices } from './sales.schema.js';
import type { CreateReceiptInput } from './sales.schemas.js';
import { SalesSettingsService } from './sales-settings.service.js';

export type ReceiptRow = typeof customerReceipts.$inferSelect;
export type AllocationRow = typeof receivableAllocations.$inferSelect;
type InvoiceRow = typeof salesInvoices.$inferSelect;

const DEBIT_DOCS = ['tax_invoice', 'bill_of_supply', 'debit_note'];
const signed = (text: string): bigint => (text.startsWith('-') ? -toUnits(text.slice(1)) : toUnits(text));
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Customer receipts and who owes what. The receivable is the general ledger (receivables control account, customer as the
 * dimension); receipts, credit notes and write-offs are *allocated* to invoices here, and the database refuses to settle more than an
 * invoice is worth or than a source holds. Reports (position, statement, ageing) are computed as of any date from immutable documents
 * and the allocation history, and the reconciliation proves they agree with the ledger customer by customer.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(SalesSettingsService) private readonly settings: SalesSettingsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- receipts ---------------------------------------------------------------------------------------------------
  createReceipt(tenantId: string, actorId: string, input: CreateReceiptInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const customer = first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, input.customerId))), 'Customer');
      if (!customer.isCustomer) throw new AppError(422, 'not_a_customer', `${customer.code} is not a customer`);
      const [deposit] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, input.companyId), eq(accounts.id, input.depositAccountId)));
      if (!deposit || deposit.type !== 'asset' || deposit.isGroup || deposit.status !== 'active' || deposit.controlKind) throw validationFailed([{ path: 'depositAccountId', message: 'Must be an active cash or bank (non-control asset) account of this company' }]);
      const settings = await this.settings.require(tx, tenantId, input.companyId, ['receivableAccountId']);
      const receiptNo = await nextDocNumber(tx, tenantId, input.companyId, input.receiptDate, 'RCT');
      const id = uuidv7();
      const { entry } = await this.posting.post(tx, tenantId, {
        companyId: input.companyId, postingDate: input.receiptDate, journalType: 'system', description: `Receipt ${receiptNo} from ${customer.tradeName ?? customer.legalName}`,
        lines: [{ accountId: input.depositAccountId, debit: input.amount, description: receiptNo }, { accountId: settings.receivableAccountId as string, credit: input.amount, partyId: customer.id, description: receiptNo }],
        source: { type: 'customer_receipt', id, event: 'post' }, postedBy: actorId,
      });
      const receipt = first(
        await tx.insert(customerReceipts).values({ tenantId, id, companyId: input.companyId, receiptNo, customerId: customer.id, receiptDate: input.receiptDate, amount: input.amount, method: input.method, depositAccountId: input.depositAccountId, reference: input.reference ?? null, notes: input.notes ?? null, journalEntryId: entry.id, createdBy: actorId }).returning(),
        'Receipt',
      );
      if (input.allocations && input.allocations.length > 0) await this.apply(tx, tenantId, actorId, { companyId: input.companyId, customerId: customer.id, source: { type: 'receipt', row: receipt }, allocatedOn: input.receiptDate, items: input.allocations });
      await this.recorder.record(tx, tenantId, 'customer_receipt', 'posted', receipt, { receiptNo, customerId: customer.id, amount: receipt.amount });
      return this.readReceipt(tx, tenantId, id);
    });
  }

  /** Cancels a receipt (a bounced cheque): reverses its journal and releases whatever it settled. */
  cancelReceipt(tenantId: string, actorId: string, id: string, input: { cancelDate: string; reason: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const receipt = first(await tx.select().from(customerReceipts).where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.id, id))).for('update'), 'Receipt');
      if (receipt.status !== 'posted') throw new AppError(409, 'already_cancelled', 'This receipt is already cancelled');
      if (input.cancelDate < receipt.receiptDate) throw validationFailed([{ path: 'cancelDate', message: 'Cannot be before the receipt date' }]);
      const [refunded] = await tx.select({ n: customerRefunds.refundNo }).from(customerRefunds).where(and(eq(customerRefunds.tenantId, tenantId), eq(customerRefunds.receiptId, id))).limit(1);
      if (refunded) throw new AppError(409, 'has_refunds', `Refund ${refunded.n} was paid out of this receipt`);
      let reversal: string | null = null;
      if (receipt.journalEntryId) reversal = (await this.posting.reverse(tx, tenantId, receipt.journalEntryId, { postingDate: input.cancelDate, reason: `Cancelled: ${input.reason}`, postedBy: actorId, allowSystem: true })).entry.id;
      await tx.update(receivableAllocations).set({ reversedOn: input.cancelDate, reversedAt: new Date() }).where(and(eq(receivableAllocations.tenantId, tenantId), eq(receivableAllocations.receiptId, id), sql`${receivableAllocations.reversedAt} IS NULL`));
      const updated = first(await tx.update(customerReceipts).set({ status: 'cancelled', cancelledAt: new Date(), cancelDate: input.cancelDate, cancelReason: input.reason, cancelJournalEntryId: reversal }).where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.id, id))).returning(), 'Receipt');
      await this.recorder.record(tx, tenantId, 'customer_receipt', 'cancelled', updated, { receiptNo: updated.receiptNo, reason: input.reason });
      return this.readReceipt(tx, tenantId, id);
    });
  }

  // ---- refunds ----------------------------------------------------------------------------------------------------
  /** Pays money back out of an unallocated receipt (an advance) or an unapplied credit note: Dr receivables (customer), Cr cash/bank. */
  refund(tenantId: string, actorId: string, input: { companyId: string; source: { type: 'receipt' | 'credit_note'; id: string }; refundDate: string; amount: string; method: ReceiptRow['method']; paidFromAccountId: string; reference?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const isReceipt = input.source.type === 'receipt';
      const receipt = isReceipt ? first(await tx.select().from(customerReceipts).where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.id, input.source.id))).for('update'), 'Receipt') : undefined;
      const note = !isReceipt ? first(await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, input.source.id))).for('update'), 'Credit note') : undefined;
      if (receipt && receipt.status !== 'posted') throw new AppError(409, 'receipt_cancelled', 'This receipt was cancelled');
      if (note && note.documentType !== 'credit_note') throw new AppError(422, 'not_a_credit_note', 'The source must be a credit note');
      const customerId = (receipt?.customerId ?? note?.customerId) as string;
      const companyId = (receipt?.companyId ?? note?.companyId) as string;
      if (companyId !== input.companyId) throw validationFailed([{ path: 'companyId', message: 'The source belongs to a different company' }]);
      const sourceDate = receipt?.receiptDate ?? (note?.invoiceDate as string);
      if (input.refundDate < sourceDate) throw validationFailed([{ path: 'refundDate', message: 'Cannot be before the receipt or credit note date' }]);
      const available = await this.unapplied(tx, tenantId, input.source);
      if (toUnits(input.amount) > available) throw new AppError(409, 'exceeds_available', `Only ${fromUnits(available)} is unallocated and can be refunded`, { available: fromUnits(available) });
      const [from] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, input.paidFromAccountId)));
      if (!from || from.type !== 'asset' || from.isGroup || from.status !== 'active' || from.controlKind) throw validationFailed([{ path: 'paidFromAccountId', message: 'Must be an active cash or bank (non-control asset) account of this company' }]);
      const settings = await this.settings.require(tx, tenantId, companyId, ['receivableAccountId']);
      const refundNo = await nextDocNumber(tx, tenantId, companyId, input.refundDate, 'RFD');
      const id = uuidv7();
      const { entry } = await this.posting.post(tx, tenantId, {
        companyId, postingDate: input.refundDate, journalType: 'system', description: `Refund ${refundNo}`,
        lines: [{ accountId: settings.receivableAccountId as string, debit: input.amount, partyId: customerId, description: refundNo }, { accountId: input.paidFromAccountId, credit: input.amount, description: refundNo }],
        source: { type: 'customer_refund', id, event: 'post' }, postedBy: actorId,
      });
      const row = first(
        await tx.insert(customerRefunds).values({ tenantId, id, companyId, refundNo, customerId, refundDate: input.refundDate, amount: input.amount, method: input.method, paidFromAccountId: input.paidFromAccountId, ...(isReceipt ? { receiptId: input.source.id } : { creditNoteId: input.source.id }), reference: input.reference ?? null, journalEntryId: entry.id, createdBy: actorId }).returning(),
        'Refund',
      );
      await this.recorder.record(tx, tenantId, 'customer_refund', 'posted', row, { refundNo, customerId, amount: input.amount, source: input.source.type });
      return row;
    });
  }

  /** What a receipt or credit note still holds: its value less active allocations and refunds. */
  private async unapplied(tx: Tx, tenantId: string, source: { type: 'receipt' | 'credit_note'; id: string }): Promise<bigint> {
    const isReceipt = source.type === 'receipt';
    const held = isReceipt
      ? (await tx.select({ v: customerReceipts.amount }).from(customerReceipts).where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.id, source.id))))[0]?.v
      : (await tx.select({ v: salesInvoices.grandTotal }).from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, source.id))))[0]?.v;
    const [alloc] = await tx.select({ s: sql<string>`COALESCE(SUM(${receivableAllocations.amount}), 0)::text` }).from(receivableAllocations).where(and(eq(receivableAllocations.tenantId, tenantId), isReceipt ? eq(receivableAllocations.receiptId, source.id) : eq(receivableAllocations.creditNoteId, source.id), sql`${receivableAllocations.reversedAt} IS NULL`));
    const [refunded] = await tx.select({ s: sql<string>`COALESCE(SUM(${customerRefunds.amount}), 0)::text` }).from(customerRefunds).where(and(eq(customerRefunds.tenantId, tenantId), isReceipt ? eq(customerRefunds.receiptId, source.id) : eq(customerRefunds.creditNoteId, source.id)));
    return toUnits(held ?? '0') - toUnits(alloc?.s ?? '0') - toUnits(refunded?.s ?? '0');
  }

  // ---- allocations ------------------------------------------------------------------------------------------------
  /** Settles invoices from a receipt or a credit note. */
  allocate(tenantId: string, actorId: string, input: { source: { type: 'receipt' | 'credit_note'; id: string }; allocatedOn: string; allocations: { invoiceId: string; amount: string }[] }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      if (input.source.type === 'receipt') {
        const receipt = first(await tx.select().from(customerReceipts).where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.id, input.source.id))).for('update'), 'Receipt');
        if (receipt.status !== 'posted') throw new AppError(409, 'receipt_cancelled', 'This receipt was cancelled');
        return this.apply(tx, tenantId, actorId, { companyId: receipt.companyId, customerId: receipt.customerId, source: { type: 'receipt', row: receipt }, allocatedOn: input.allocatedOn, items: input.allocations });
      }
      const note = first(await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, input.source.id))).for('update'), 'Credit note');
      if (note.documentType !== 'credit_note') throw new AppError(422, 'not_a_credit_note', 'The source must be a credit note');
      return this.apply(tx, tenantId, actorId, { companyId: note.companyId, customerId: note.customerId, source: { type: 'credit_note', row: note }, allocatedOn: input.allocatedOn, items: input.allocations });
    });
  }

  reverseAllocation(tenantId: string, id: string, input: { on: string; reason: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const a = first(await tx.select().from(receivableAllocations).where(and(eq(receivableAllocations.tenantId, tenantId), eq(receivableAllocations.id, id))).for('update'), 'Allocation');
      if (a.writeOffEntryId) throw new AppError(409, 'write_off_final', 'A write-off is a journal entry and cannot be un-allocated');
      if (a.reversedAt) throw new AppError(409, 'already_reversed', 'This allocation was already reversed');
      if (input.on < a.allocatedOn) throw validationFailed([{ path: 'on', message: 'Cannot be before the allocation date' }]);
      const updated = first(await tx.update(receivableAllocations).set({ reversedOn: input.on, reversedAt: new Date() }).where(and(eq(receivableAllocations.tenantId, tenantId), eq(receivableAllocations.id, id))).returning(), 'Allocation');
      await this.recorder.record(tx, tenantId, 'receivable_allocation', 'reversed', updated, { reason: input.reason, amount: updated.amount });
      return updated;
    });
  }

  /** Writes off (a discount or bad debt) part of an invoice: Dr write-off account, Cr receivables, and settles the invoice by that amount. */
  writeOff(tenantId: string, actorId: string, input: { invoiceId: string; amount: string; date: string; reason: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const invoice = first(await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, input.invoiceId))).for('update'), 'Invoice');
      this.assertSettleable(invoice);
      if (input.date < invoice.invoiceDate) throw validationFailed([{ path: 'date', message: 'Cannot be before the invoice date' }]);
      const outstanding = await this.outstanding(tx, tenantId, invoice);
      if (toUnits(input.amount) > outstanding) throw new AppError(409, 'exceeds_outstanding', `Only ${fromUnits(outstanding)} is outstanding on ${invoice.invoiceNo}`, { outstanding: fromUnits(outstanding) });
      const settings = await this.settings.require(tx, tenantId, invoice.companyId, ['receivableAccountId', 'writeOffAccountId']);
      const { entry } = await this.posting.post(tx, tenantId, {
        companyId: invoice.companyId, postingDate: input.date, journalType: 'system', description: `Write-off against ${invoice.invoiceNo}: ${input.reason}`,
        lines: [{ accountId: settings.writeOffAccountId as string, debit: input.amount }, { accountId: settings.receivableAccountId as string, credit: input.amount, partyId: invoice.customerId }],
        source: { type: 'receivable_write_off', id: uuidv7(), event: 'post' }, postedBy: actorId,
      });
      const row = first(await tx.insert(receivableAllocations).values({ tenantId, id: uuidv7(), companyId: invoice.companyId, customerId: invoice.customerId, invoiceId: invoice.id, writeOffEntryId: entry.id, amount: input.amount, allocatedOn: input.date, reason: input.reason, createdBy: actorId }).returning(), 'Allocation');
      await this.recorder.record(tx, tenantId, 'receivable_write_off', 'posted', row, { invoiceNo: invoice.invoiceNo, amount: input.amount, reason: input.reason });
      return row;
    });
  }

  private assertSettleable(invoice: InvoiceRow): void {
    if (!DEBIT_DOCS.includes(invoice.documentType)) throw new AppError(422, 'not_settleable', 'Only invoices, bills of supply and debit notes are settled');
    if (invoice.status !== 'posted') throw new AppError(409, 'invoice_cancelled', `${invoice.invoiceNo} was cancelled`);
  }

  private async outstanding(tx: Tx, tenantId: string, invoice: InvoiceRow): Promise<bigint> {
    const [r] = await tx.select({ s: sql<string>`COALESCE(SUM(${receivableAllocations.amount}), 0)::text` }).from(receivableAllocations).where(and(eq(receivableAllocations.tenantId, tenantId), eq(receivableAllocations.invoiceId, invoice.id), sql`${receivableAllocations.reversedAt} IS NULL`));
    return toUnits(invoice.grandTotal) - toUnits(r?.s ?? '0');
  }

  private async apply(tx: Tx, tenantId: string, actorId: string, p: { companyId: string; customerId: string; source: { type: 'receipt'; row: ReceiptRow } | { type: 'credit_note'; row: InvoiceRow }; allocatedOn: string; items: { invoiceId: string; amount: string }[] }): Promise<AllocationRow[]> {
    const sourceDate = p.source.type === 'receipt' ? p.source.row.receiptDate : p.source.row.invoiceDate;
    const held = toUnits(p.source.type === 'receipt' ? p.source.row.amount : p.source.row.grandTotal);
    const where = p.source.type === 'receipt' ? eq(receivableAllocations.receiptId, p.source.row.id) : eq(receivableAllocations.creditNoteId, p.source.row.id);
    const [used] = await tx.select({ s: sql<string>`COALESCE(SUM(${receivableAllocations.amount}), 0)::text` }).from(receivableAllocations).where(and(eq(receivableAllocations.tenantId, tenantId), where, sql`${receivableAllocations.reversedAt} IS NULL`));
    const [refunded] = await tx.select({ s: sql<string>`COALESCE(SUM(${customerRefunds.amount}), 0)::text` }).from(customerRefunds).where(and(eq(customerRefunds.tenantId, tenantId), p.source.type === 'receipt' ? eq(customerRefunds.receiptId, p.source.row.id) : eq(customerRefunds.creditNoteId, p.source.row.id)));
    let available = held - toUnits(used?.s ?? '0') - toUnits(refunded?.s ?? '0');
    const byInvoice = new Map<string, bigint>();
    for (const it of p.items) byInvoice.set(it.invoiceId, (byInvoice.get(it.invoiceId) ?? 0n) + toUnits(it.amount));
    const rows: AllocationRow[] = [];
    for (const invoiceId of [...byInvoice.keys()].sort()) { // fixed lock order
      const invoice = first(await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, invoiceId))).for('update'), 'Invoice');
      if (invoice.customerId !== p.customerId) throw validationFailed([{ path: 'allocations', message: `${invoice.invoiceNo} belongs to a different customer` }]);
      this.assertSettleable(invoice);
      if (p.allocatedOn < invoice.invoiceDate || p.allocatedOn < sourceDate) throw validationFailed([{ path: 'allocatedOn', message: 'Cannot be before the invoice or the receipt/credit note date' }]);
      const amount = byInvoice.get(invoiceId) as bigint;
      const outstanding = await this.outstanding(tx, tenantId, invoice);
      if (amount > outstanding) throw new AppError(409, 'exceeds_outstanding', `Only ${fromUnits(outstanding)} is outstanding on ${invoice.invoiceNo}`, { invoiceId, outstanding: fromUnits(outstanding) });
      if (amount > available) throw new AppError(409, 'exceeds_available', `Only ${fromUnits(available)} of this ${p.source.type === 'receipt' ? 'receipt' : 'credit note'} is unallocated`, { available: fromUnits(available) });
      available -= amount;
      rows.push(first(await tx.insert(receivableAllocations).values({ tenantId, id: uuidv7(), companyId: p.companyId, customerId: p.customerId, invoiceId, ...(p.source.type === 'receipt' ? { receiptId: p.source.row.id } : { creditNoteId: p.source.row.id }), amount: fromUnits(amount), allocatedOn: p.allocatedOn, createdBy: actorId }).returning(), 'Allocation'));
    }
    for (const r of rows) await this.recorder.record(tx, tenantId, 'receivable_allocation', 'created', r, { invoiceId: r.invoiceId, amount: r.amount, source: p.source.type });
    return rows;
  }

  // ---- reads ------------------------------------------------------------------------------------------------------
  getReceipt(tenantId: string, id: string) { return this.uow.inTenant(tenantId, (tx) => this.readReceipt(tx, tenantId, id), { readOnly: true }); }
  private async readReceipt(tx: Tx, tenantId: string, id: string) {
    const receipt = first(await tx.select().from(customerReceipts).where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.id, id))), 'Receipt');
    const allocations = await tx.select().from(receivableAllocations).where(and(eq(receivableAllocations.tenantId, tenantId), eq(receivableAllocations.receiptId, id))).orderBy(asc(receivableAllocations.id));
    const allocated = allocations.filter((a) => !a.reversedAt).reduce((s, a) => s + toUnits(a.amount), 0n);
    const [refunded] = await tx.select({ s: sql<string>`COALESCE(SUM(${customerRefunds.amount}), 0)::text` }).from(customerRefunds).where(and(eq(customerRefunds.tenantId, tenantId), eq(customerRefunds.receiptId, id)));
    return { receipt, allocations, unallocated: receipt.status === 'posted' ? fromUnits(toUnits(receipt.amount) - allocated - toUnits(refunded?.s ?? '0')) : '0.0000' };
  }
  listReceipts(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; customerId?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(customerReceipts).where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.companyId, q.companyId), before ? lt(customerReceipts.id, before) : undefined, q.customerId ? eq(customerReceipts.customerId, q.customerId) : undefined, q.status ? eq(customerReceipts.status, q.status) : undefined)).orderBy(desc(customerReceipts.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }

  /** Open invoices and unapplied receipts/credit notes as of a date, optionally for one customer. */
  private async openItems(tx: Tx, tenantId: string, companyId: string, asOf: string, customerId?: string) {
    const cust = customerId ? sql`AND i.customer_id = ${customerId}::uuid` : sql``;
    const invoices = await tx.execute<{ id: string; invoice_no: string; document_type: string; invoice_date: string; due_date: string; customer_id: string; customer_name: string; grand_total: string; outstanding: string }>(sql`
      SELECT i.id, i.invoice_no, i.document_type, i.invoice_date::text, COALESCE(i.due_date, i.invoice_date)::text AS due_date, i.customer_id, i.customer_name, i.grand_total::text,
             (i.grand_total - COALESCE((SELECT SUM(a.amount) FROM erp.receivable_allocations a WHERE a.tenant_id = i.tenant_id AND a.invoice_id = i.id AND a.allocated_on <= ${asOf}::date AND (a.reversed_on IS NULL OR a.reversed_on > ${asOf}::date)), 0))::text AS outstanding
        FROM erp.sales_invoices i
       WHERE i.tenant_id = ${tenantId}::uuid AND i.company_id = ${companyId}::uuid AND i.document_type IN ('tax_invoice', 'bill_of_supply', 'debit_note') AND i.invoice_date <= ${asOf}::date
         AND (i.status = 'posted' OR i.cancel_date > ${asOf}::date) ${cust}
       ORDER BY i.invoice_date, i.invoice_no`);
    const unapplied = await tx.execute<{ kind: string; id: string; number: string; date: string; customer_id: string; unapplied: string }>(sql`
      SELECT 'receipt' AS kind, r.id, r.receipt_no AS number, r.receipt_date::text AS date, r.customer_id,
             (r.amount - COALESCE((SELECT SUM(a.amount) FROM erp.receivable_allocations a WHERE a.tenant_id = r.tenant_id AND a.receipt_id = r.id AND a.allocated_on <= ${asOf}::date AND (a.reversed_on IS NULL OR a.reversed_on > ${asOf}::date)), 0)
                       - COALESCE((SELECT SUM(f.amount) FROM erp.customer_refunds f WHERE f.tenant_id = r.tenant_id AND f.receipt_id = r.id AND f.refund_date <= ${asOf}::date), 0))::text AS unapplied
        FROM erp.customer_receipts r
       WHERE r.tenant_id = ${tenantId}::uuid AND r.company_id = ${companyId}::uuid AND r.receipt_date <= ${asOf}::date AND (r.status = 'posted' OR r.cancel_date > ${asOf}::date) ${customerId ? sql`AND r.customer_id = ${customerId}::uuid` : sql``}
      UNION ALL
      SELECT 'credit_note', i.id, i.invoice_no, i.invoice_date::text, i.customer_id,
             (i.grand_total - COALESCE((SELECT SUM(a.amount) FROM erp.receivable_allocations a WHERE a.tenant_id = i.tenant_id AND a.credit_note_id = i.id AND a.allocated_on <= ${asOf}::date AND (a.reversed_on IS NULL OR a.reversed_on > ${asOf}::date)), 0)
                       - COALESCE((SELECT SUM(f.amount) FROM erp.customer_refunds f WHERE f.tenant_id = i.tenant_id AND f.credit_note_id = i.id AND f.refund_date <= ${asOf}::date), 0))::text
        FROM erp.sales_invoices i
       WHERE i.tenant_id = ${tenantId}::uuid AND i.company_id = ${companyId}::uuid AND i.document_type = 'credit_note' AND i.invoice_date <= ${asOf}::date AND i.status = 'posted' ${cust}`);
    return { invoices: invoices.rows.filter((r) => signed(r.outstanding) > 0n), unapplied: unapplied.rows.filter((r) => signed(r.unapplied) > 0n) };
  }

  /** What a customer owes: open invoices, receipts and credit notes not yet applied, and the net balance. */
  position(tenantId: string, companyId: string, customerId: string, asOf: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const customer = first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, customerId))), 'Customer');
      const { invoices, unapplied } = await this.openItems(tx, tenantId, companyId, asOf, customerId);
      const owed = invoices.reduce((s, r) => s + signed(r.outstanding), 0n);
      const credits = unapplied.reduce((s, r) => s + signed(r.unapplied), 0n);
      return {
        customer: { id: customer.id, code: customer.code, name: customer.tradeName ?? customer.legalName, creditLimit: customer.creditLimit }, asOf,
        openInvoices: invoices.map((r) => ({ id: r.id, number: r.invoice_no, type: r.document_type, date: r.invoice_date, dueDate: r.due_date, total: r.grand_total, outstanding: r.outstanding, daysOverdue: Math.max(0, daysBetween(r.due_date, asOf)) })),
        unapplied: unapplied.map((r) => ({ kind: r.kind, id: r.id, number: r.number, date: r.date, amount: r.unapplied })),
        totalOutstanding: fromUnits(owed), totalUnapplied: fromUnits(credits), balance: fromUnits(owed - credits),
        creditLimitExceeded: customer.creditLimit !== null && owed - credits > toUnits(customer.creditLimit),
      };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  /** Receivables ageing by days past due: current, 1-30, 31-60, 61-90, over 90 (unapplied credits shown separately). */
  ageing(tenantId: string, companyId: string, asOf: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const { invoices, unapplied } = await this.openItems(tx, tenantId, companyId, asOf);
      const keys = ['current', 'days1to30', 'days31to60', 'days61to90', 'over90'] as const;
      const bucketOf = (days: number) => (days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4);
      const byCustomer = new Map<string, { customerId: string; customerName: string; buckets: bigint[]; unapplied: bigint }>();
      const row = (id: string, name: string) => {
        let r = byCustomer.get(id);
        if (!r) byCustomer.set(id, (r = { customerId: id, customerName: name, buckets: [0n, 0n, 0n, 0n, 0n], unapplied: 0n }));
        return r;
      };
      for (const i of invoices) row(i.customer_id, i.customer_name).buckets[bucketOf(daysBetween(i.due_date, asOf))]! += signed(i.outstanding);
      const names = new Map(invoices.map((i) => [i.customer_id, i.customer_name]));
      for (const u of unapplied) {
        let name = names.get(u.customer_id);
        if (!name) name = (await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, u.customer_id))).then((r) => r[0]?.tradeName ?? r[0]?.legalName)) ?? '';
        row(u.customer_id, name).unapplied += signed(u.unapplied);
      }
      const out = [...byCustomer.values()].sort((a, b) => a.customerName.localeCompare(b.customerName)).map((r) => ({
        customerId: r.customerId, customerName: r.customerName, ...Object.fromEntries(keys.map((k, n) => [k, fromUnits(r.buckets[n] as bigint)])), total: fromUnits(r.buckets.reduce((a, b) => a + b, 0n)), unapplied: fromUnits(r.unapplied),
      }));
      const totals = Object.fromEntries(keys.map((k, n) => [k, fromUnits([...byCustomer.values()].reduce((s, r) => s + (r.buckets[n] as bigint), 0n))]));
      return { asOf, customers: out, totals: { ...totals, total: fromUnits([...byCustomer.values()].reduce((s, r) => s + r.buckets.reduce((a, b) => a + b, 0n), 0n)), unapplied: fromUnits([...byCustomer.values()].reduce((s, r) => s + r.unapplied, 0n)) } };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  /** A customer's statement: every movement in the period with a running balance, starting from the opening balance. */
  statement(tenantId: string, companyId: string, customerId: string, from: string, to: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const customer = first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, customerId))), 'Customer');
      const res = await tx.execute<{ date: string; kind: string; number: string; debit: string; credit: string; ord: string }>(sql`
        SELECT * FROM (
          SELECT i.invoice_date::text AS date, i.document_type AS kind, i.invoice_no AS number, CASE WHEN i.document_type = 'credit_note' THEN 0 ELSE i.grand_total END::text AS debit, CASE WHEN i.document_type = 'credit_note' THEN i.grand_total ELSE 0 END::text AS credit, i.id::text AS ord
            FROM erp.sales_invoices i WHERE i.tenant_id = ${tenantId}::uuid AND i.company_id = ${companyId}::uuid AND i.customer_id = ${customerId}::uuid AND i.invoice_date <= ${to}::date
          UNION ALL
          SELECT i.cancel_date::text, 'cancellation', i.invoice_no, '0', i.grand_total::text, i.id::text || 'c' FROM erp.sales_invoices i
           WHERE i.tenant_id = ${tenantId}::uuid AND i.company_id = ${companyId}::uuid AND i.customer_id = ${customerId}::uuid AND i.status = 'cancelled' AND i.cancel_date <= ${to}::date
          UNION ALL
          SELECT r.receipt_date::text, 'receipt', r.receipt_no, '0', r.amount::text, r.id::text FROM erp.customer_receipts r
           WHERE r.tenant_id = ${tenantId}::uuid AND r.company_id = ${companyId}::uuid AND r.customer_id = ${customerId}::uuid AND r.receipt_date <= ${to}::date
          UNION ALL
          SELECT r.cancel_date::text, 'receipt_cancelled', r.receipt_no, r.amount::text, '0', r.id::text || 'c' FROM erp.customer_receipts r
           WHERE r.tenant_id = ${tenantId}::uuid AND r.company_id = ${companyId}::uuid AND r.customer_id = ${customerId}::uuid AND r.status = 'cancelled' AND r.cancel_date <= ${to}::date
          UNION ALL
          SELECT f.refund_date::text, 'refund', f.refund_no, f.amount::text, '0', f.id::text FROM erp.customer_refunds f
           WHERE f.tenant_id = ${tenantId}::uuid AND f.company_id = ${companyId}::uuid AND f.customer_id = ${customerId}::uuid AND f.refund_date <= ${to}::date
          UNION ALL
          SELECT a.allocated_on::text, 'write_off', i.invoice_no, '0', a.amount::text, a.id::text FROM erp.receivable_allocations a JOIN erp.sales_invoices i ON i.tenant_id = a.tenant_id AND i.id = a.invoice_id
           WHERE a.tenant_id = ${tenantId}::uuid AND a.company_id = ${companyId}::uuid AND a.customer_id = ${customerId}::uuid AND a.write_off_entry_id IS NOT NULL AND a.allocated_on <= ${to}::date
        ) m ORDER BY date, ord`);
      let balance = 0n;
      let opening = 0n;
      const lines = [];
      for (const m of res.rows) {
        const delta = toUnits(m.debit) - toUnits(m.credit);
        if (m.date < from) { opening += delta; balance += delta; continue; }
        balance += delta;
        lines.push({ date: m.date, kind: m.kind, number: m.number, debit: m.debit === '0' ? '0.0000' : m.debit, credit: m.credit === '0' ? '0.0000' : m.credit, balance: fromUnits(balance) });
      }
      return { customer: { id: customer.id, code: customer.code, name: customer.tradeName ?? customer.legalName }, from, to, openingBalance: fromUnits(opening), lines, closingBalance: fromUnits(balance) };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  /**
   * Proves the receivables documents and the general ledger agree, customer by customer: invoices and debit notes, less credit notes,
   * receipts and write-offs, plus refunds paid out (as of the date, honouring cancellations) against the customer's balance on the receivables control account.
   */
  reconciliation(tenantId: string, companyId: string, asOf: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const settings = await this.settings.require(tx, tenantId, companyId, ['receivableAccountId']);
      const res = await tx.execute<{ customer_id: string | null; name: string | null; documents: string; ledger: string }>(sql`
        WITH docs AS (
          SELECT customer_id, SUM(CASE WHEN document_type = 'credit_note' THEN -grand_total ELSE grand_total END) AS v FROM erp.sales_invoices
           WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND invoice_date <= ${asOf}::date AND (status = 'posted' OR cancel_date > ${asOf}::date) GROUP BY customer_id),
        rcpt AS (
          SELECT customer_id, SUM(amount) AS v FROM erp.customer_receipts
           WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND receipt_date <= ${asOf}::date AND (status = 'posted' OR cancel_date > ${asOf}::date) GROUP BY customer_id),
        wo AS (
          SELECT customer_id, SUM(amount) AS v FROM erp.receivable_allocations
           WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND write_off_entry_id IS NOT NULL AND allocated_on <= ${asOf}::date GROUP BY customer_id),
        refunds AS (
          SELECT customer_id, SUM(amount) AS v FROM erp.customer_refunds
           WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND refund_date <= ${asOf}::date GROUP BY customer_id),
        gl AS (
          SELECT party_id AS customer_id, SUM(debit - credit) AS v FROM erp.journal_lines
           WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND account_id = ${settings.receivableAccountId}::uuid AND posting_date <= ${asOf}::date GROUP BY party_id),
        ids AS (SELECT customer_id FROM docs UNION SELECT customer_id FROM rcpt UNION SELECT customer_id FROM wo UNION SELECT customer_id FROM refunds UNION SELECT customer_id FROM gl)
        SELECT ids.customer_id, COALESCE(p.trade_name, p.legal_name) AS name,
               (COALESCE(docs.v, 0) - COALESCE(rcpt.v, 0) - COALESCE(wo.v, 0) + COALESCE(refunds.v, 0))::text AS documents, COALESCE(gl.v, 0)::text AS ledger
          FROM ids LEFT JOIN docs USING (customer_id) LEFT JOIN rcpt USING (customer_id) LEFT JOIN wo USING (customer_id) LEFT JOIN refunds USING (customer_id) LEFT JOIN gl USING (customer_id)
          LEFT JOIN erp.parties p ON p.tenant_id = ${tenantId}::uuid AND p.id = ids.customer_id
         ORDER BY name NULLS LAST`);
      let documentsTotal = 0n;
      let ledgerTotal = 0n;
      const rows = res.rows.map((r) => {
        const d = signed(r.documents);
        const l = signed(r.ledger);
        documentsTotal += d;
        ledgerTotal += l;
        return { customerId: r.customer_id, customerName: r.name ?? '(no customer on the ledger line)', documents: fromUnits(d), ledger: fromUnits(l), difference: fromUnits(l - d), reconciled: d === l };
      });
      return { companyId, asOf, rows, documentsTotal: fromUnits(documentsTotal), ledgerTotal: fromUnits(ledgerTotal), difference: fromUnits(ledgerTotal - documentsTotal), reconciled: rows.every((r) => r.reconciled) };
    }, { readOnly: true, isolation: 'repeatable read' });
  }
}
