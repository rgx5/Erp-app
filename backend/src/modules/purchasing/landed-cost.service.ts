import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { accounts } from '../accounting/accounting.schema.js';
import { PostingService, type PostingLine } from '../accounting/posting.service.js';
import { qty, value } from '../inventory/decimal.js';
import { StockService, type RevalueLine } from '../inventory/stock.service.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { nextDocNumber } from '../sales/doc-number.js';
import { allocateProportionally } from './allocate.js';
import { goodsReceiptLines, goodsReceipts, landedCostCharges, landedCostLines, landedCostVouchers } from './purchasing.schema.js';
import type { CreateLandedCostInput } from './purchasing.schemas.js';
import { PurchasingSettingsService } from './purchasing-settings.service.js';

export type VoucherRow = typeof landedCostVouchers.$inferSelect;

/**
 * Landed cost: freight, duty, insurance and similar charges that were booked as expenses are moved into the cost of the goods they
 * brought in. The total is shared over the chosen receipt lines (by booked value or by quantity, to the last unit of money), the
 * stock is revalued through `StockService.revalue` (weighted-average stock: the average moves; FIFO stock: the receipt's own cost
 * layer), and the charge accounts are relieved. The part that relates to units already sold or used goes to the cost-variance account.
 */
@Injectable()
export class LandedCostService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(PurchasingSettingsService) private readonly settings: PurchasingSettingsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  create(tenantId: string, actorId: string, input: CreateLandedCostInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const acc = await this.settings.require(tx, tenantId, input.companyId, ['freightAccountId', 'costVarianceAccountId']);
      // Each charge must come from an ordinary expense account of the company.
      const chargeAccounts = new Map((await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, input.companyId), inArray(accounts.id, [...new Set(input.charges.map((c) => c.accountId))])))).map((a) => [a.id, a]));
      input.charges.forEach((c, i) => {
        const a = chargeAccounts.get(c.accountId);
        if (!a || a.isGroup || a.status !== 'active' || a.controlKind || a.type !== 'expense') throw validationFailed([{ path: `charges.${i}.accountId`, message: 'Must be an active, ordinary expense account of this company' }]);
        if (c.accountId === acc.freightAccountId) throw validationFailed([{ path: `charges.${i}.accountId`, message: 'This is the landed-cost clearing account itself; name the account the charge was booked to' }]);
      });
      const ids = [...new Set(input.receiptLines)].sort();
      if (ids.length !== input.receiptLines.length) throw validationFailed([{ path: 'receiptLines', message: 'A receipt line appears twice' }]);
      const rows: (typeof goodsReceiptLines.$inferSelect)[] = [];
      for (const id of ids) {
        const [line] = await tx.select().from(goodsReceiptLines).where(and(eq(goodsReceiptLines.tenantId, tenantId), eq(goodsReceiptLines.id, id))).for('share');
        if (!line) throw validationFailed([{ path: 'receiptLines', message: 'A receipt line does not exist' }]);
        rows.push(line);
      }
      const lines = input.receiptLines.map((id) => rows.find((r) => r.id === id) as typeof goodsReceiptLines.$inferSelect);
      // The receipts must belong to the company and not be a stranger's (the receipt row carries the company).
      const receiptIds = [...new Set(lines.map((l) => l.receiptId))];
      const receiptCompany = await tx.select({ id: goodsReceipts.id }).from(goodsReceipts).where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.companyId, input.companyId), inArray(goodsReceipts.id, receiptIds)));
      if (receiptCompany.length !== receiptIds.length) throw validationFailed([{ path: 'receiptLines', message: 'A receipt line belongs to another company' }]);

      const net = lines.map((l) => qty.parse(l.quantity) - qty.parse(l.quantityReturned)); // what was kept
      if (net.some((q) => q <= 0n)) throw new AppError(409, 'nothing_received', 'A chosen receipt line was entirely returned; there is no stock to add cost to');
      const weights = input.basis === 'value'
        ? lines.map((l, i) => (qty.parse(l.quantity) === 0n ? 0n : (value.parse(l.value) * (net[i] as bigint)) / qty.parse(l.quantity)))
        : net;
      const total = input.charges.reduce((a, c) => a + value.parse(c.amount), 0n);
      if (weights.every((w) => w === 0n)) throw new AppError(422, 'no_basis', 'The chosen lines carry no value to share the charges over; use the quantity basis');
      const shares = allocateProportionally(total, weights);

      const id = uuidv7();
      const voucherNo = await nextDocNumber(tx, tenantId, input.companyId, input.voucherDate, 'LC');
      const revalueLines: RevalueLine[] = lines.map((l, i) => ({ warehouseId: l.warehouseId, itemId: l.itemId, amount: value.format(shares[i] as bigint), receivedQuantity: qty.format(net[i] as bigint), ledgerId: l.stockLedgerId ?? undefined }));
      const { movement, lines: outcome } = await this.stock.revalue(tx, tenantId, {
        companyId: input.companyId, postingDate: input.voucherDate, description: `Landed cost ${voucherNo}: ${input.description}`, lines: revalueLines.filter((_, i) => (shares[i] as bigint) > 0n),
        offsetAccountId: acc.freightAccountId as string, expenseAccountId: acc.costVarianceAccountId as string, source: { type: 'landed_cost', id, event: 'capitalise' }, postedBy: actorId,
      });
      // The clearing account was credited by the revaluation; relieve the accounts the charges were booked to.
      const j: PostingLine[] = [];
      for (const c of input.charges) { j.push({ accountId: acc.freightAccountId as string, debit: c.amount, description: voucherNo }, { accountId: c.accountId, credit: c.amount, description: voucherNo }); }
      const { entry } = await this.posting.post(tx, tenantId, {
        companyId: input.companyId, postingDate: input.voucherDate, journalType: 'system', description: `Landed cost ${voucherNo}: ${input.description}`, lines: j,
        source: { type: 'landed_cost', id, event: 'charges' }, postedBy: actorId,
      });
      const header = first(await tx.insert(landedCostVouchers).values({ tenantId, id, companyId: input.companyId, voucherNo, voucherDate: input.voucherDate, description: input.description, basis: input.basis, totalAmount: value.format(total), journalEntryId: entry.id, revaluationMovementId: movement?.id ?? null, createdBy: actorId }).returning(), 'Landed cost voucher');
      const charges = await tx.insert(landedCostCharges).values(input.charges.map((c, i) => ({ tenantId, id: uuidv7(), voucherId: id, lineNo: i + 1, kind: c.kind, description: c.description ?? c.kind.replaceAll('_', ' '), amount: c.amount, accountId: c.accountId }))).returning();
      let at = 0;
      const outcomes = revalueLines.map((_, i) => ((shares[i] as bigint) > 0n ? outcome[at++] : { capitalised: '0.0000', expensed: '0.0000' }));
      const allocated = await tx.insert(landedCostLines).values(lines.map((l, i) => ({
        tenantId, id: uuidv7(), voucherId: id, lineNo: i + 1, grnLineId: l.id, itemId: l.itemId, quantity: qty.format(net[i] as bigint), basisValue: value.format(weights[i] as bigint), allocated: value.format(shares[i] as bigint),
        capitalised: outcomes[i]?.capitalised ?? '0.0000', expensed: outcomes[i]?.expensed ?? '0.0000',
      }))).returning();
      await this.recorder.record(tx, tenantId, 'landed_cost_voucher', 'posted', header, { voucherNo, total: header.totalAmount, basis: input.basis, lines: allocated.length });
      return { voucher: header, charges, lines: allocated };
    });
  }

  /** Takes the cost back out of the stock and puts the charges back on the accounts they came from. */
  cancel(tenantId: string, actorId: string, id: string, input: { cancelDate: string; reason: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const v = first(await tx.select().from(landedCostVouchers).where(and(eq(landedCostVouchers.tenantId, tenantId), eq(landedCostVouchers.id, id))).for('update'), 'Landed cost voucher');
      if (v.status !== 'posted') throw new AppError(409, 'already_cancelled', 'This voucher is already cancelled');
      if (input.cancelDate < v.voucherDate) throw validationFailed([{ path: 'cancelDate', message: 'Cannot be before the voucher date' }]);
      const acc = await this.settings.require(tx, tenantId, v.companyId, ['freightAccountId', 'costVarianceAccountId']);
      const lines = await tx.select().from(landedCostLines).where(and(eq(landedCostLines.tenantId, tenantId), eq(landedCostLines.voucherId, id))).orderBy(asc(landedCostLines.lineNo));
      const grn = new Map((await tx.select().from(goodsReceiptLines).where(and(eq(goodsReceiptLines.tenantId, tenantId), inArray(goodsReceiptLines.id, lines.map((l) => l.grnLineId))))).map((g) => [g.id, g]));
      const back = lines.filter((l) => value.parse(l.allocated) > 0n).map((l): RevalueLine => {
        const g = grn.get(l.grnLineId) as typeof goodsReceiptLines.$inferSelect;
        return { warehouseId: g.warehouseId, itemId: l.itemId, amount: `-${l.allocated}`, receivedQuantity: l.quantity, ledgerId: g.stockLedgerId ?? undefined };
      });
      if (back.length > 0) await this.stock.revalue(tx, tenantId, { companyId: v.companyId, postingDate: input.cancelDate, description: `Cancellation of ${v.voucherNo}`, lines: back, offsetAccountId: acc.freightAccountId as string, expenseAccountId: acc.costVarianceAccountId as string, source: { type: 'landed_cost', id, event: 'capitalise_cancel' }, postedBy: actorId });
      const { entry } = await this.posting.reverse(tx, tenantId, v.journalEntryId, { postingDate: input.cancelDate, reason: `Cancelled: ${input.reason}`, postedBy: actorId, allowSystem: true });
      const updated = first(await tx.update(landedCostVouchers).set({ status: 'cancelled', cancelledAt: new Date(), cancelDate: input.cancelDate, cancelReason: input.reason, cancelJournalEntryId: entry.id }).where(and(eq(landedCostVouchers.tenantId, tenantId), eq(landedCostVouchers.id, id))).returning(), 'Landed cost voucher');
      await this.recorder.record(tx, tenantId, 'landed_cost_voucher', 'cancelled', updated, { voucherNo: updated.voucherNo, reason: input.reason });
      return this.read(tx, tenantId, id);
    });
  }

  get(tenantId: string, id: string) { return this.uow.inTenant(tenantId, (tx) => this.read(tx, tenantId, id), { readOnly: true }); }
  private async read(tx: Tx, tenantId: string, id: string) {
    return {
      voucher: first(await tx.select().from(landedCostVouchers).where(and(eq(landedCostVouchers.tenantId, tenantId), eq(landedCostVouchers.id, id))), 'Landed cost voucher'),
      charges: await tx.select().from(landedCostCharges).where(and(eq(landedCostCharges.tenantId, tenantId), eq(landedCostCharges.voucherId, id))).orderBy(asc(landedCostCharges.lineNo)),
      lines: await tx.select().from(landedCostLines).where(and(eq(landedCostLines.tenantId, tenantId), eq(landedCostLines.voucherId, id))).orderBy(asc(landedCostLines.lineNo)),
    };
  }
  list(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(landedCostVouchers).where(and(eq(landedCostVouchers.tenantId, tenantId), eq(landedCostVouchers.companyId, q.companyId), before ? lt(landedCostVouchers.id, before) : undefined, q.status ? eq(landedCostVouchers.status, q.status) : undefined)).orderBy(desc(landedCostVouchers.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }
}

