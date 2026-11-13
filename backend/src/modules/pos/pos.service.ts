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
import { ReceivablesService } from '../sales/receivables.service.js';
import { salesInvoiceLines, salesInvoices } from '../sales/sales.schema.js';
import { SalesInvoiceService } from '../sales/sales-invoice.service.js';
import { businessLocations, gstRegistrations, warehouses } from '../organization/organization.schema.js';
import { posPaymentAccounts, posPayments, posSales, posSettings, posShifts, posTerminals } from './pos.schema.js';
import type { PosReturnInput, PosSaleInput } from './pos.schemas.js';

export type TerminalRow = typeof posTerminals.$inferSelect;
export type ShiftRow = typeof posShifts.$inferSelect;
type Method = 'cash' | 'bank_transfer' | 'upi' | 'card' | 'cheque' | 'other';

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Counter selling. A POS sale IS a sales invoice (tax-inclusive prices, walk-in customer by default) plus the receipts taken at the
 * till, allocated to it, posted in one transaction; a POS return IS a credit note plus the refund paid out. A shift is the cash drawer:
 * closing it compares the cash counted with what the books say should be there and posts any difference to the cash over/short account.
 */
@Injectable()
export class PosService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(SalesInvoiceService) private readonly invoices: SalesInvoiceService,
    @Inject(ReceivablesService) private readonly receivables: ReceivablesService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- configuration --------------------------------------------------------------------------------------------------
  getSettings(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, async (tx) => ({
      settings: (await tx.select().from(posSettings).where(and(eq(posSettings.tenantId, tenantId), eq(posSettings.companyId, companyId))))[0] ?? null,
      paymentAccounts: await tx.select().from(posPaymentAccounts).where(and(eq(posPaymentAccounts.tenantId, tenantId), eq(posPaymentAccounts.companyId, companyId))).orderBy(asc(posPaymentAccounts.method)),
    }), { readOnly: true });
  }

  putSettings(tenantId: string, companyId: string, input: { walkInCustomerId?: string | null | undefined; cashVarianceAccountId?: string | null | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      if (input.walkInCustomerId) {
        const [c] = await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, input.walkInCustomerId)));
        if (!c || !c.isCustomer || c.status !== 'active') throw validationFailed([{ path: 'walkInCustomerId', message: 'Must be an active customer' }]);
      }
      if (input.cashVarianceAccountId) await this.requireAccount(tx, tenantId, companyId, input.cashVarianceAccountId, ['expense', 'income'], 'cashVarianceAccountId', 'an ordinary income or expense account');
      const [existing] = await tx.select().from(posSettings).where(and(eq(posSettings.tenantId, tenantId), eq(posSettings.companyId, companyId))).for('update');
      const row = existing
        ? first(await tx.update(posSettings).set(input).where(and(eq(posSettings.tenantId, tenantId), eq(posSettings.companyId, companyId))).returning(), 'POS settings')
        : first(await tx.insert(posSettings).values({ tenantId, companyId, ...input }).returning(), 'POS settings');
      await this.recorder.record(tx, tenantId, 'pos_settings', 'updated', { id: companyId }, { companyId, fields: Object.keys(input) });
      return row;
    });
  }

  mapPayment(tenantId: string, companyId: string, method: Method, accountId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.requireAccount(tx, tenantId, companyId, accountId, ['asset'], 'accountId', 'an active cash or bank (non-control asset) account');
      const row = first(await tx.insert(posPaymentAccounts).values({ tenantId, id: uuidv7(), companyId, method, accountId }).onConflictDoUpdate({ target: [posPaymentAccounts.tenantId, posPaymentAccounts.companyId, posPaymentAccounts.method], set: { accountId } }).returning(), 'Payment account');
      return this.recorder.record(tx, tenantId, 'pos_payment_account', 'mapped', row, { companyId, method, accountId });
    });
  }

  createTerminal(tenantId: string, input: { companyId: string; code: string; name: string; gstRegistrationId: string; businessLocationId: string; warehouseId: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [r] = await tx.select().from(gstRegistrations).where(and(eq(gstRegistrations.tenantId, tenantId), eq(gstRegistrations.companyId, input.companyId), eq(gstRegistrations.id, input.gstRegistrationId)));
      if (!r) throw validationFailed([{ path: 'gstRegistrationId', message: 'This GST registration does not belong to the company' }]);
      const [loc] = await tx.select().from(businessLocations).where(and(eq(businessLocations.tenantId, tenantId), eq(businessLocations.companyId, input.companyId), eq(businessLocations.id, input.businessLocationId)));
      if (!loc) throw validationFailed([{ path: 'businessLocationId', message: 'This location does not belong to the company' }]);
      const [w] = await tx.select().from(warehouses).where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.businessLocationId, input.businessLocationId), eq(warehouses.id, input.warehouseId)));
      if (!w) throw validationFailed([{ path: 'warehouseId', message: 'This warehouse is not at that location' }]);
      const row = first(await tx.insert(posTerminals).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Terminal');
      return this.recorder.record(tx, tenantId, 'pos_terminal', 'created', row, { code: input.code });
    });
  }
  listTerminals(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, (tx) => tx.select().from(posTerminals).where(and(eq(posTerminals.tenantId, tenantId), eq(posTerminals.companyId, companyId))).orderBy(asc(posTerminals.code)), { readOnly: true });
  }

  // ---- shifts -------------------------------------------------------------------------------------------------------
  openShift(tenantId: string, actorId: string, input: { terminalId: string; openingCash: string; date?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const terminal = first(await tx.select().from(posTerminals).where(and(eq(posTerminals.tenantId, tenantId), eq(posTerminals.id, input.terminalId))).for('share'), 'Terminal');
      if (terminal.status !== 'active') throw new AppError(422, 'terminal_inactive', `Terminal ${terminal.code} is inactive`);
      const [open] = await tx.select({ id: posShifts.id }).from(posShifts).where(and(eq(posShifts.tenantId, tenantId), eq(posShifts.terminalId, terminal.id), eq(posShifts.status, 'open')));
      if (open) throw new AppError(409, 'shift_already_open', `Terminal ${terminal.code} already has an open shift`);
      const shiftNo = await nextDocNumber(tx, tenantId, terminal.companyId, input.date ?? today(), 'SHF');
      const shift = first(await tx.insert(posShifts).values({ tenantId, id: uuidv7(), companyId: terminal.companyId, terminalId: terminal.id, shiftNo, openedBy: actorId, openingCash: input.openingCash }).returning(), 'Shift');
      return this.recorder.record(tx, tenantId, 'pos_shift', 'opened', shift, { shiftNo, terminal: terminal.code, openingCash: input.openingCash });
    });
  }

  /** Cash-up: counted cash against what the books say the drawer should hold; any difference goes to the cash over/short account. */
  closeShift(tenantId: string, actorId: string, shiftId: string, input: { countedCash: string; date?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const shift = await this.lockOpenShift(tx, tenantId, shiftId);
      const summary = await this.summarise(tx, tenantId, shift);
      const expected = toUnits(summary.expectedCash);
      const counted = toUnits(input.countedCash);
      const variance = counted - expected;
      let entryId: string | null = null;
      if (variance !== 0n) {
        const [settings] = await tx.select().from(posSettings).where(and(eq(posSettings.tenantId, tenantId), eq(posSettings.companyId, shift.companyId)));
        const [cash] = await tx.select().from(posPaymentAccounts).where(and(eq(posPaymentAccounts.tenantId, tenantId), eq(posPaymentAccounts.companyId, shift.companyId), eq(posPaymentAccounts.method, 'cash')));
        if (!settings?.cashVarianceAccountId || !cash) throw new AppError(409, 'pos_not_configured', 'Set the cash over/short account and the cash payment account in the POS settings first');
        const short = variance < 0n;
        const amount = fromUnits(short ? -variance : variance);
        entryId = (
          await this.posting.post(tx, tenantId, {
            companyId: shift.companyId, postingDate: input.date ?? today(), journalType: 'system', description: `Cash ${short ? 'short' : 'over'} on shift ${shift.shiftNo}`,
            lines: short ? [{ accountId: settings.cashVarianceAccountId, debit: amount }, { accountId: cash.accountId, credit: amount }] : [{ accountId: cash.accountId, debit: amount }, { accountId: settings.cashVarianceAccountId, credit: amount }],
            source: { type: 'pos_shift', id: shift.id, event: 'close' }, postedBy: actorId,
          })
        ).entry.id;
      }
      const closed = first(
        await tx.update(posShifts).set({ status: 'closed', closedBy: actorId, closedAt: new Date(), countedCash: input.countedCash, expectedCash: fromUnits(expected), variance: fromUnits(variance), varianceEntryId: entryId }).where(and(eq(posShifts.tenantId, tenantId), eq(posShifts.id, shiftId))).returning(),
        'Shift',
      );
      await this.recorder.record(tx, tenantId, 'pos_shift', 'closed', closed, { shiftNo: closed.shiftNo, expectedCash: closed.expectedCash, countedCash: closed.countedCash, variance: closed.variance });
      return { shift: closed, summary: await this.summarise(tx, tenantId, closed) };
    });
  }

  // ---- counter sale ----------------------------------------------------------------------------------------------------
  sale(tenantId: string, actorId: string, input: PosSaleInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const shift = await this.lockOpenShift(tx, tenantId, input.shiftId);
      const terminal = first(await tx.select().from(posTerminals).where(and(eq(posTerminals.tenantId, tenantId), eq(posTerminals.id, shift.terminalId))), 'Terminal');
      const [settings] = await tx.select().from(posSettings).where(and(eq(posSettings.tenantId, tenantId), eq(posSettings.companyId, shift.companyId)));
      const customerId = input.customerId ?? settings?.walkInCustomerId;
      if (!customerId) throw new AppError(409, 'pos_not_configured', 'Set a walk-in customer in the POS settings, or name a customer on the sale');
      const date = input.date ?? today();
      const accountsByMethod = await this.paymentAccounts(tx, tenantId, shift.companyId);

      const posted = await this.invoices.postInvoice(tx, tenantId, actorId, {
        companyId: shift.companyId, gstRegistrationId: terminal.gstRegistrationId, businessLocationId: terminal.businessLocationId, documentType: 'tax_invoice', invoiceDate: date, customerId, reverseCharge: false,
        lines: input.lines.map((l) => ({ itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, taxCodeId: l.taxCodeId, warehouseId: l.warehouseId ?? terminal.warehouseId, batchId: l.batchId, serialNos: l.serialNos })),
      });
      const grand = toUnits(posted.invoice.grandTotal);
      const paid = input.payments.reduce((s, p) => s + toUnits(p.amount), 0n);
      if (paid !== grand) throw new AppError(422, 'payment_mismatch', `The payments (${fromUnits(paid)}) must equal the sale total (${fromUnits(grand)})`, { total: fromUnits(grand), paid: fromUnits(paid) });

      const sale = first(await tx.insert(posSales).values({ tenantId, id: uuidv7(), companyId: shift.companyId, shiftId: shift.id, terminalId: terminal.id, kind: 'sale', documentId: posted.invoice.id, createdBy: actorId }).returning(), 'POS sale');
      const payments = [];
      let change = 0n;
      for (const p of input.payments) {
        const tendered = toUnits(p.tendered ?? p.amount);
        if (tendered < toUnits(p.amount)) throw validationFailed([{ path: 'payments', message: 'The amount tendered cannot be less than the amount paid' }]);
        if (p.method !== 'cash' && tendered !== toUnits(p.amount)) throw validationFailed([{ path: 'payments', message: 'Only cash can be tendered above the amount (and change given)' }]);
        const account = accountsByMethod.get(p.method);
        if (!account) throw new AppError(409, 'pos_not_configured', `Map the ${p.method} payment method to an account in the POS settings first`);
        const r = await this.receivables.createReceipt(tenantId, actorId, { companyId: shift.companyId, customerId, receiptDate: date, amount: p.amount, method: p.method, depositAccountId: account, reference: p.reference, allocations: [{ invoiceId: posted.invoice.id, amount: p.amount }] });
        const changeGiven = tendered - toUnits(p.amount);
        change += changeGiven;
        payments.push(first(await tx.insert(posPayments).values({ tenantId, id: uuidv7(), posSaleId: sale.id, method: p.method, amount: p.amount, tendered: fromUnits(tendered), changeGiven: fromUnits(changeGiven), reference: p.reference ?? null, receiptId: r.receipt.id }).returning(), 'POS payment'));
      }
      await this.recorder.record(tx, tenantId, 'pos_sale', 'posted', sale, { invoiceNo: posted.invoice.invoiceNo, total: posted.invoice.grandTotal, shiftNo: shift.shiftNo });
      return { sale, invoice: posted.invoice, lines: posted.lines, warnings: posted.warnings, payments, changeDue: fromUnits(change) };
    });
  }

  /** A counter return: credit note against a counter sale, stock back at its original cost, and the refund paid out. */
  return(tenantId: string, actorId: string, input: PosReturnInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const shift = await this.lockOpenShift(tx, tenantId, input.shiftId);
      const original = first(await tx.select().from(posSales).where(and(eq(posSales.tenantId, tenantId), eq(posSales.id, input.originalSaleId))), 'POS sale');
      if (original.kind !== 'sale' || original.companyId !== shift.companyId) throw new AppError(422, 'not_a_sale', 'Returns are made against a counter sale of the same company');
      const date = input.date ?? today();
      const accountsByMethod = await this.paymentAccounts(tx, tenantId, shift.companyId);
      const note = await this.invoices.createCreditNote(tenantId, actorId, {
        originalInvoiceId: original.documentId, noteDate: date, reason: input.reason,
        lines: input.lines.map((l) => ({ originalLineId: l.originalLineId, quantity: l.quantity, unitPrice: l.unitPrice, serialNos: l.serialNos, warehouseId: l.warehouseId })),
      });
      const due = toUnits(note.invoice.grandTotal);
      const refunded = input.refunds.reduce((s, r) => s + toUnits(r.amount), 0n);
      if (refunded !== due) throw new AppError(422, 'refund_mismatch', `The refunds (${fromUnits(refunded)}) must equal the credit note total (${fromUnits(due)})`, { total: fromUnits(due), refunded: fromUnits(refunded) });
      const ret = first(await tx.insert(posSales).values({ tenantId, id: uuidv7(), companyId: shift.companyId, shiftId: shift.id, terminalId: shift.terminalId, kind: 'return', documentId: note.invoice.id, createdBy: actorId }).returning(), 'POS return');
      const payments = [];
      for (const r of input.refunds) {
        const account = accountsByMethod.get(r.method);
        if (!account) throw new AppError(409, 'pos_not_configured', `Map the ${r.method} payment method to an account in the POS settings first`);
        const refund = await this.receivables.refund(tenantId, actorId, { companyId: shift.companyId, source: { type: 'credit_note', id: note.invoice.id }, refundDate: date, amount: r.amount, method: r.method, paidFromAccountId: account, reference: r.reference });
        payments.push(first(await tx.insert(posPayments).values({ tenantId, id: uuidv7(), posSaleId: ret.id, method: r.method, amount: r.amount, tendered: r.amount, changeGiven: '0', reference: r.reference ?? null, refundId: refund.id }).returning(), 'POS refund'));
      }
      await this.recorder.record(tx, tenantId, 'pos_sale', 'returned', ret, { creditNoteNo: note.invoice.invoiceNo, total: note.invoice.grandTotal, shiftNo: shift.shiftNo });
      return { sale: ret, creditNote: note.invoice, lines: note.lines, payments };
    });
  }

  // ---- reads -----------------------------------------------------------------------------------------------------------
  getShift(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const shift = first(await tx.select().from(posShifts).where(and(eq(posShifts.tenantId, tenantId), eq(posShifts.id, id))), 'Shift');
      return { shift, summary: await this.summarise(tx, tenantId, shift) };
    }, { readOnly: true });
  }
  listShifts(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; terminalId?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(posShifts).where(and(eq(posShifts.tenantId, tenantId), eq(posShifts.companyId, q.companyId), before ? lt(posShifts.id, before) : undefined, q.terminalId ? eq(posShifts.terminalId, q.terminalId) : undefined, q.status ? eq(posShifts.status, q.status) : undefined)).orderBy(desc(posShifts.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }
  listSales(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; shiftId?: string | undefined; kind?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ s: posSales, invoiceNo: salesInvoices.invoiceNo, total: salesInvoices.grandTotal })
        .from(posSales)
        .innerJoin(salesInvoices, and(eq(salesInvoices.tenantId, posSales.tenantId), eq(salesInvoices.id, posSales.documentId)))
        .where(and(eq(posSales.tenantId, tenantId), eq(posSales.companyId, q.companyId), before ? lt(posSales.id, before) : undefined, q.shiftId ? eq(posSales.shiftId, q.shiftId) : undefined, q.kind ? eq(posSales.kind, q.kind) : undefined))
        .orderBy(desc(posSales.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit).map((r) => ({ ...r.s, documentNo: r.invoiceNo, total: r.total }));
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }
  getSale(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const sale = first(await tx.select().from(posSales).where(and(eq(posSales.tenantId, tenantId), eq(posSales.id, id))), 'POS sale');
      const payments = await tx.select().from(posPayments).where(and(eq(posPayments.tenantId, tenantId), eq(posPayments.posSaleId, id))).orderBy(asc(posPayments.id));
      const [invoice] = await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, sale.documentId)));
      const lines = await tx.select().from(salesInvoiceLines).where(and(eq(salesInvoiceLines.tenantId, tenantId), eq(salesInvoiceLines.invoiceId, sale.documentId))).orderBy(asc(salesInvoiceLines.lineNo));
      return { sale, invoice, lines, payments };
    }, { readOnly: true });
  }

  // ---- internals --------------------------------------------------------------------------------------------------------
  /** Sales, returns and payments by method for a shift, and the cash the drawer should hold. */
  private async summarise(tx: Tx, tenantId: string, shift: ShiftRow) {
    const rows = await tx.execute<{ kind: string; method: string; amount: string; n: string }>(sql`
      SELECT s.kind, p.method, SUM(p.amount)::text AS amount, COUNT(DISTINCT s.id)::text AS n
        FROM erp.pos_sales s JOIN erp.pos_payments p ON p.tenant_id = s.tenant_id AND p.pos_sale_id = s.id
       WHERE s.tenant_id = ${tenantId}::uuid AND s.shift_id = ${shift.id}::uuid GROUP BY s.kind, p.method ORDER BY s.kind, p.method`);
    const docs = await tx.execute<{ kind: string; n: string; total: string }>(sql`
      SELECT s.kind, COUNT(*)::text AS n, COALESCE(SUM(i.grand_total), 0)::text AS total FROM erp.pos_sales s JOIN erp.sales_invoices i ON i.tenant_id = s.tenant_id AND i.id = s.document_id
       WHERE s.tenant_id = ${tenantId}::uuid AND s.shift_id = ${shift.id}::uuid GROUP BY s.kind`);
    const byMethod = (kind: string) => Object.fromEntries(rows.rows.filter((r) => r.kind === kind).map((r) => [r.method, r.amount]));
    const sum = (kind: string, method?: string) => rows.rows.filter((r) => r.kind === kind && (!method || r.method === method)).reduce((s, r) => s + toUnits(r.amount), 0n);
    const doc = (kind: string) => docs.rows.find((d) => d.kind === kind);
    const expected = toUnits(shift.openingCash) + sum('sale', 'cash') - sum('return', 'cash');
    return {
      salesCount: Number(doc('sale')?.n ?? 0), salesTotal: doc('sale')?.total ?? '0', returnsCount: Number(doc('return')?.n ?? 0), returnsTotal: doc('return')?.total ?? '0',
      paymentsReceived: byMethod('sale'), refundsPaid: byMethod('return'), expectedCash: fromUnits(expected), openingCash: shift.openingCash,
    };
  }

  private async lockOpenShift(tx: Tx, tenantId: string, id: string): Promise<ShiftRow> {
    const shift = first(await tx.select().from(posShifts).where(and(eq(posShifts.tenantId, tenantId), eq(posShifts.id, id))).for('update'), 'Shift');
    if (shift.status !== 'open') throw new AppError(409, 'shift_closed', `Shift ${shift.shiftNo} is closed`);
    return shift;
  }

  private async paymentAccounts(tx: Tx, tenantId: string, companyId: string): Promise<Map<string, string>> {
    return new Map((await tx.select().from(posPaymentAccounts).where(and(eq(posPaymentAccounts.tenantId, tenantId), eq(posPaymentAccounts.companyId, companyId)))).map((r) => [r.method, r.accountId]));
  }

  private async requireAccount(tx: Tx, tenantId: string, companyId: string, id: string, types: string[], field: string, label: string): Promise<void> {
    const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, id)));
    if (!a || a.isGroup || a.status !== 'active' || a.controlKind || !types.includes(a.type)) throw validationFailed([{ path: field, message: `Must be ${label}` }]);
  }
}
