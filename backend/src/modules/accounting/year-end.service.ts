import { Inject, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { accountingSettings, fiscalYearClosings, fiscalYears } from './accounting.schema.js';
import { fromUnits } from './money.js';
import { PostingService, type PostingLine } from './posting.service.js';
import { StatementsService } from './statements.service.js';

/**
 * Year-end close: one journal entry dated the last day of the fiscal year that zeroes every income and expense account into the
 * retained-earnings account. The books close in order (a year needs the previous one closed), the last period must still be open to
 * receive the entry, and reopening reverses it. Statements leave closing entries out of the profit and loss, so a closed year still
 * shows its result.
 */
@Injectable()
export class YearEndService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(StatementsService) private readonly statements: StatementsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  close(tenantId: string, actorId: string, fiscalYearId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const fy = first(await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.id, fiscalYearId))), 'Fiscal year');
      // Serialise closers of the same company.
      const [settings] = await tx.select().from(accountingSettings).where(and(eq(accountingSettings.tenantId, tenantId), eq(accountingSettings.companyId, fy.companyId))).for('update');
      if (!settings?.retainedEarningsAccountId) throw new AppError(409, 'accounting_accounts_not_configured', 'Set the retained-earnings account in the company accounting settings first', { missing: ['retainedEarningsAccountId'] });
      const [live] = await tx.select().from(fiscalYearClosings).where(and(eq(fiscalYearClosings.tenantId, tenantId), eq(fiscalYearClosings.fiscalYearId, fiscalYearId), eq(fiscalYearClosings.status, 'closed')));
      if (live) throw new AppError(409, 'year_already_closed', `${fy.label} is already closed`);
      const earlier = await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.companyId, fy.companyId), lt(fiscalYears.endDate, fy.startDate)));
      for (const e of earlier) {
        const [c] = await tx.select({ id: fiscalYearClosings.id }).from(fiscalYearClosings).where(and(eq(fiscalYearClosings.tenantId, tenantId), eq(fiscalYearClosings.fiscalYearId, e.id), eq(fiscalYearClosings.status, 'closed')));
        if (!c) throw new AppError(409, 'earlier_year_open', `Close ${e.label} first`);
      }
      const rows = (await this.statements.nets(tx, tenantId, fy.companyId, { from: fy.startDate, to: fy.endDate }, true, ['income', 'expense'])).filter((r) => r.net !== 0n);
      const profit = -rows.reduce((a, r) => a + r.net, 0n);
      let entryId: string | null = null;
      if (rows.length > 0) {
        const lines: PostingLine[] = rows.map((r) => (r.net > 0n ? { accountId: r.id, credit: fromUnits(r.net), description: `Close ${fy.label}` } : { accountId: r.id, debit: fromUnits(-r.net), description: `Close ${fy.label}` }));
        if (profit !== 0n) lines.push(profit > 0n ? { accountId: settings.retainedEarningsAccountId, credit: fromUnits(profit), description: `Profit of ${fy.label}` } : { accountId: settings.retainedEarningsAccountId, debit: fromUnits(-profit), description: `Loss of ${fy.label}` });
        const { entry } = await this.posting.post(tx, tenantId, { companyId: fy.companyId, postingDate: fy.endDate, journalType: 'system', description: `Year-end closing of ${fy.label}`, lines, source: { type: 'year_end', id: fiscalYearId, event: 'close' }, postedBy: actorId });
        entryId = entry.id;
      }
      const row = first(await tx.insert(fiscalYearClosings).values({ tenantId, id: uuidv7(), companyId: fy.companyId, fiscalYearId, closingEntryId: entryId, netProfit: fromUnits(profit), closedBy: actorId }).returning(), 'Closing');
      await this.recorder.record(tx, tenantId, 'fiscal_year', 'closed', { id: fiscalYearId }, { label: fy.label, netProfit: row.netProfit, entryId });
      return row;
    });
  }

  /** Reverses the closing entry. The last period must be open again, and no later year may be closed. */
  reopen(tenantId: string, actorId: string, fiscalYearId: string, reason: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const fy = first(await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.id, fiscalYearId))), 'Fiscal year');
      const [live] = await tx.select().from(fiscalYearClosings).where(and(eq(fiscalYearClosings.tenantId, tenantId), eq(fiscalYearClosings.fiscalYearId, fiscalYearId), eq(fiscalYearClosings.status, 'closed'))).for('update');
      if (!live) throw new AppError(409, 'year_not_closed', `${fy.label} is not closed`);
      const later = await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.companyId, fy.companyId), gt(fiscalYears.startDate, fy.endDate)));
      for (const l of later) {
        const [c] = await tx.select({ id: fiscalYearClosings.id }).from(fiscalYearClosings).where(and(eq(fiscalYearClosings.tenantId, tenantId), eq(fiscalYearClosings.fiscalYearId, l.id), eq(fiscalYearClosings.status, 'closed')));
        if (c) throw new AppError(409, 'later_year_closed', `Reopen ${l.label} first`);
      }
      if (live.closingEntryId) await this.posting.reverse(tx, tenantId, live.closingEntryId, { postingDate: fy.endDate, reason: `Reopened: ${reason}`, postedBy: actorId, allowSystem: true });
      const row = first(await tx.update(fiscalYearClosings).set({ status: 'reopened', reopenedBy: actorId, reopenedAt: new Date(), reopenReason: reason }).where(and(eq(fiscalYearClosings.tenantId, tenantId), eq(fiscalYearClosings.id, live.id))).returning(), 'Closing');
      await this.recorder.record(tx, tenantId, 'fiscal_year', 'reopened', { id: fiscalYearId }, { label: fy.label, reason });
      return row;
    });
  }

  list(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.select().from(fiscalYearClosings).where(and(eq(fiscalYearClosings.tenantId, tenantId), eq(fiscalYearClosings.companyId, companyId))).orderBy(desc(fiscalYearClosings.closedAt), asc(fiscalYearClosings.id))), { readOnly: true });
  }
}
