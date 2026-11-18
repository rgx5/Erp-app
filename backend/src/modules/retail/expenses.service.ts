import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, lte } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, toPage } from '../../platform/http/validation.js';
import { accounts } from '../accounting/accounting.schema.js';
import { PostingService } from '../accounting/posting.service.js';
import { first, Recorder, updateVersioned } from '../masterdata/helpers.js';
import { nextDocNumber } from '../sales/doc-number.js';
import { expenseCategories, expenseVouchers } from './retail.schema.js';
import type { CreateExpenseCategoryInput, CreateExpenseInput, UpdateExpenseCategoryInput } from './expenses.schemas.js';

export type ExpenseCategoryRow = typeof expenseCategories.$inferSelect;
export type ExpenseRow = typeof expenseVouchers.$inferSelect;

/**
 * Small expenses paid from the till or the bank. A category names the expense account; a voucher posts Dr expense / Cr cash-or-bank.
 * No tax is split out (a bill with input credit belongs in purchasing as a supplier bill); the amount is booked in full as the expense.
 */
@Injectable()
export class ExpensesService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  private async requireExpenseAccount(tx: Tx, tenantId: string, companyId: string, id: string, path: string): Promise<void> {
    const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, id)));
    if (!a || a.type !== 'expense' || a.isGroup || a.status !== 'active' || a.controlKind) throw validationFailed([{ path, message: 'Must be an active, ordinary expense account of this company' }]);
  }
  private async requireCash(tx: Tx, tenantId: string, companyId: string, id: string): Promise<void> {
    const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, id)));
    if (!a || a.type !== 'asset' || a.isGroup || a.status !== 'active' || a.controlKind) throw validationFailed([{ path: 'paidFromAccountId', message: 'Must be an active cash or bank (non-control asset) account of this company' }]);
  }

  createCategory(tenantId: string, input: CreateExpenseCategoryInput): Promise<ExpenseCategoryRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.requireExpenseAccount(tx, tenantId, input.companyId, input.expenseAccountId, 'expenseAccountId');
      try {
        return this.recorder.record(tx, tenantId, 'expense_category', 'created', first(await tx.insert(expenseCategories).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Category'), { code: input.code });
      } catch (e) { if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw new AppError(409, 'category_exists', 'An expense category with that code already exists'); throw e; }
    });
  }
  listCategories(tenantId: string, companyId: string, status?: 'active' | 'inactive') {
    return this.uow.inTenant(tenantId, (tx) => tx.select().from(expenseCategories).where(and(eq(expenseCategories.tenantId, tenantId), eq(expenseCategories.companyId, companyId), status ? eq(expenseCategories.status, status) : undefined)).orderBy(expenseCategories.name), { readOnly: true });
  }
  updateCategory(tenantId: string, id: string, version: number, input: UpdateExpenseCategoryInput): Promise<ExpenseCategoryRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      if (input.expenseAccountId) { const c = first(await tx.select().from(expenseCategories).where(and(eq(expenseCategories.tenantId, tenantId), eq(expenseCategories.id, id))), 'Category'); await this.requireExpenseAccount(tx, tenantId, c.companyId, input.expenseAccountId, 'expenseAccountId'); }
      return this.recorder.record(tx, tenantId, 'expense_category', 'updated', await updateVersioned<ExpenseCategoryRow>(tx, expenseCategories, tenantId, id, version, input, 'Category'), { fields: Object.keys(input) });
    });
  }

  create(tenantId: string, actorId: string, input: CreateExpenseInput): Promise<ExpenseRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const cat = first(await tx.select().from(expenseCategories).where(and(eq(expenseCategories.tenantId, tenantId), eq(expenseCategories.companyId, input.companyId), eq(expenseCategories.id, input.categoryId))), 'Category');
      if (cat.status !== 'active') throw validationFailed([{ path: 'categoryId', message: 'This category is inactive' }]);
      await this.requireCash(tx, tenantId, input.companyId, input.paidFromAccountId);
      const voucherNo = await nextDocNumber(tx, tenantId, input.companyId, input.voucherDate, 'EXP');
      const id = uuidv7();
      const desc = `${cat.name}${input.payee ? ` to ${input.payee}` : ''}`;
      const { entry } = await this.posting.post(tx, tenantId, {
        companyId: input.companyId, postingDate: input.voucherDate, journalType: 'system', description: `Expense ${voucherNo}: ${desc}`,
        lines: [{ accountId: cat.expenseAccountId, debit: input.amount, description: input.note ?? desc }, { accountId: input.paidFromAccountId, credit: input.amount, description: voucherNo }],
        source: { type: 'expense_voucher', id, event: 'post' }, postedBy: actorId,
      });
      const row = first(await tx.insert(expenseVouchers).values({ tenantId, id, companyId: input.companyId, voucherNo, voucherDate: input.voucherDate, categoryId: cat.id, amount: input.amount, paidFromAccountId: input.paidFromAccountId, payee: input.payee ?? null, note: input.note ?? null, journalEntryId: entry.id, createdBy: actorId }).returning(), 'Voucher');
      return this.recorder.record(tx, tenantId, 'expense_voucher', 'posted', row, { voucherNo, amount: input.amount, category: cat.code });
    });
  }

  async list(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; categoryId?: string | undefined; from?: string | undefined; to?: string | undefined; status?: 'posted' | 'cancelled' | undefined }) {
    const before = decodeCursor(q.cursor);
    const rows = await this.uow.inTenant(tenantId, (tx) => tx.select().from(expenseVouchers).where(and(eq(expenseVouchers.tenantId, tenantId), eq(expenseVouchers.companyId, q.companyId), before ? lt(expenseVouchers.id, before) : undefined, q.categoryId ? eq(expenseVouchers.categoryId, q.categoryId) : undefined, q.from ? gte(expenseVouchers.voucherDate, q.from) : undefined, q.to ? lte(expenseVouchers.voucherDate, q.to) : undefined, q.status ? eq(expenseVouchers.status, q.status) : undefined)).orderBy(desc(expenseVouchers.id)).limit(q.limit + 1), { readOnly: true });
    return toPage(rows, q.limit);
  }
  get(tenantId: string, id: string): Promise<ExpenseRow> {
    return this.uow.inTenant(tenantId, async (tx) => first(await tx.select().from(expenseVouchers).where(and(eq(expenseVouchers.tenantId, tenantId), eq(expenseVouchers.id, id))), 'Voucher'), { readOnly: true });
  }

  cancel(tenantId: string, actorId: string, id: string, input: { date: string; reason: string }): Promise<ExpenseRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const v = first(await tx.select().from(expenseVouchers).where(and(eq(expenseVouchers.tenantId, tenantId), eq(expenseVouchers.id, id))).for('update'), 'Voucher');
      if (v.status === 'cancelled') throw new AppError(409, 'already_cancelled', 'This voucher is already cancelled');
      if (input.date < v.voucherDate) throw validationFailed([{ path: 'date', message: 'Cannot be before the voucher date' }]);
      const { entry } = await this.posting.reverse(tx, tenantId, v.journalEntryId, { postingDate: input.date, reason: `Cancelled: ${input.reason}`, postedBy: actorId, allowSystem: true });
      const row = first(await tx.update(expenseVouchers).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: input.reason, cancelJournalId: entry.id }).where(and(eq(expenseVouchers.tenantId, tenantId), eq(expenseVouchers.id, id))).returning(), 'Voucher');
      return this.recorder.record(tx, tenantId, 'expense_voucher', 'cancelled', row, { voucherNo: v.voucherNo, reason: input.reason });
    });
  }
}
