import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, lt, ne } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, notFound } from '../../platform/http/errors.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { accountingPeriods, fiscalYears } from './accounting.schema.js';
import type { CreateFiscalYearInput } from './accounting.schemas.js';

export type FiscalYearRow = typeof fiscalYears.$inferSelect;
export type PeriodRow = typeof accountingPeriods.$inferSelect;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d = 1): Date => new Date(Date.UTC(y, m, d));

/** Twelve consecutive calendar-month periods starting on `start` (a 1st), and the year's end date. */
export function monthlyPeriods(start: string): { label: string; endDate: string; periods: { no: number; name: string; start: string; end: string }[] } {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7)) - 1;
  const periods = Array.from({ length: 12 }, (_, i) => {
    const from = utc(y, m + i);
    const next = utc(y, m + i + 1);
    return { no: i + 1, name: `${MONTHS[from.getUTCMonth()]} ${from.getUTCFullYear()}`, start: iso(from), end: iso(new Date(next.getTime() - 86_400_000)) };
  });
  const endDate = (periods[11] as { end: string }).end;
  const endYear = Number(endDate.slice(0, 4));
  return { label: endYear === y ? String(y) : `${y}-${String(endYear % 100).padStart(2, '0')}`, endDate, periods };
}

@Injectable()
export class PeriodsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  /** Creates a fiscal year of twelve monthly periods. Overlap with an existing year is refused by the database. */
  createFiscalYear(tenantId: string, input: CreateFiscalYearInput): Promise<{ fiscalYear: FiscalYearRow; periods: PeriodRow[] }> {
    const plan = monthlyPeriods(input.startDate);
    return this.uow.inTenant(tenantId, async (tx) => {
      const fiscalYear = first(
        await tx.insert(fiscalYears).values({ tenantId, id: uuidv7(), companyId: input.companyId, label: input.label ?? plan.label, startDate: input.startDate, endDate: plan.endDate }).returning(),
        'Fiscal year',
      );
      const periods = await tx
        .insert(accountingPeriods)
        .values(plan.periods.map((p) => ({ tenantId, id: uuidv7(), companyId: input.companyId, fiscalYearId: fiscalYear.id, periodNo: p.no, name: p.name, startDate: p.start, endDate: p.end })))
        .returning();
      await this.recorder.record(tx, tenantId, 'fiscal_year', 'created', fiscalYear, { companyId: input.companyId, label: fiscalYear.label, startDate: fiscalYear.startDate, endDate: fiscalYear.endDate });
      return { fiscalYear, periods };
    });
  }

  list(tenantId: string, companyId: string): Promise<{ fiscalYear: FiscalYearRow; periods: PeriodRow[] }[]> {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const years = await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.companyId, companyId))).orderBy(asc(fiscalYears.startDate));
        const periods = await tx.select().from(accountingPeriods).where(and(eq(accountingPeriods.tenantId, tenantId), eq(accountingPeriods.companyId, companyId))).orderBy(asc(accountingPeriods.startDate));
        return years.map((fiscalYear) => ({ fiscalYear, periods: periods.filter((p) => p.fiscalYearId === fiscalYear.id) }));
      },
      { readOnly: true },
    );
  }

  /**
   * The open period containing `date`, with its row locked FOR SHARE until the transaction ends: a concurrent close waits for
   * this posting, and this posting waits for a close in progress. Throws 409 if there is none or it is not open.
   */
  async openPeriodFor(tx: Tx, tenantId: string, companyId: string, date: string): Promise<{ period: PeriodRow; fiscalYear: FiscalYearRow }> {
    const [period] = await tx
      .select()
      .from(accountingPeriods)
      .where(and(eq(accountingPeriods.tenantId, tenantId), eq(accountingPeriods.companyId, companyId), lt(accountingPeriods.startDate, nextDay(date)), gt(accountingPeriods.endDate, prevDay(date))))
      .for('share');
    if (!period) throw new AppError(409, 'no_accounting_period', `No accounting period covers ${date}; create the fiscal year first`);
    if (period.status !== 'open') throw new AppError(409, 'period_closed', `The accounting period ${period.name} is ${period.status}; ${date} cannot be posted to`);
    const [fiscalYear] = await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.id, period.fiscalYearId)));
    if (!fiscalYear) throw notFound('Fiscal year');
    return { period, fiscalYear };
  }

  /** Close (open -> closed): earlier periods must already be closed, so the books close in order. */
  close(tenantId: string, id: string): Promise<PeriodRow> {
    return this.transition(tenantId, id, 'closed', async (tx, p) => {
      if (p.status !== 'open') throw new AppError(409, 'invalid_transition', `A ${p.status} period cannot be closed`);
      const earlier = await tx.select({ id: accountingPeriods.id }).from(accountingPeriods).where(and(eq(accountingPeriods.tenantId, tenantId), eq(accountingPeriods.companyId, p.companyId), lt(accountingPeriods.startDate, p.startDate), eq(accountingPeriods.status, 'open'))).limit(1);
      if (earlier.length > 0) throw new AppError(409, 'earlier_period_open', 'Close the earlier open period first');
      return { status: 'closed', closedAt: new Date() };
    });
  }

  /** Reopen (closed -> open): only if no later period has been closed, so the books reopen newest first. A locked period never reopens. */
  reopen(tenantId: string, id: string): Promise<PeriodRow> {
    return this.transition(tenantId, id, 'reopened', async (tx, p) => {
      if (p.status === 'locked') throw new AppError(409, 'period_locked', 'A locked period can never be reopened');
      if (p.status !== 'closed') throw new AppError(409, 'invalid_transition', 'Only a closed period can be reopened');
      const later = await tx.select({ id: accountingPeriods.id }).from(accountingPeriods).where(and(eq(accountingPeriods.tenantId, tenantId), eq(accountingPeriods.companyId, p.companyId), gt(accountingPeriods.startDate, p.startDate), ne(accountingPeriods.status, 'open'))).limit(1);
      if (later.length > 0) throw new AppError(409, 'later_period_closed', 'Reopen the later closed periods first');
      return { status: 'open', closedAt: null };
    });
  }

  /** Lock (closed -> locked): permanent. Every earlier period must be closed or locked. */
  lock(tenantId: string, id: string): Promise<PeriodRow> {
    return this.transition(tenantId, id, 'locked', async (tx, p) => {
      if (p.status !== 'closed') throw new AppError(409, 'invalid_transition', 'Only a closed period can be locked');
      const earlier = await tx.select({ id: accountingPeriods.id }).from(accountingPeriods).where(and(eq(accountingPeriods.tenantId, tenantId), eq(accountingPeriods.companyId, p.companyId), lt(accountingPeriods.startDate, p.startDate), eq(accountingPeriods.status, 'open'))).limit(1);
      if (earlier.length > 0) throw new AppError(409, 'earlier_period_open', 'Close the earlier open period first');
      return { status: 'locked', lockedAt: new Date() };
    });
  }

  private transition(tenantId: string, id: string, verb: string, decide: (tx: Tx, p: PeriodRow) => Promise<Partial<PeriodRow>>): Promise<PeriodRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      // FOR UPDATE waits for postings in flight (they hold FOR SHARE) and blocks new ones until this commits.
      const period = first(await tx.select().from(accountingPeriods).where(and(eq(accountingPeriods.tenantId, tenantId), eq(accountingPeriods.id, id))).for('update'), 'Accounting period');
      const change = await decide(tx, period);
      const updated = first(await tx.update(accountingPeriods).set(change).where(and(eq(accountingPeriods.tenantId, tenantId), eq(accountingPeriods.id, id))).returning(), 'Accounting period');
      return this.recorder.record(tx, tenantId, 'accounting_period', verb, updated, { companyId: updated.companyId, period: updated.name, status: updated.status });
    });
  }
}

const prevDay = (d: string): string => iso(new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000));
const nextDay = (d: string): string => iso(new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000));
