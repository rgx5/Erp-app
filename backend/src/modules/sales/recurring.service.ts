import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { items } from '../masterdata/masterdata.schema.js';
import { recurringInvoiceRuns, recurringInvoices, salesInvoices } from './sales.schema.js';
import type { CreateRecurringInput } from './sales.schemas.js';
import { SalesInvoiceService } from './sales-invoice.service.js';

export type RecurringRow = typeof recurringInvoices.$inferSelect;
const today = (): string => new Date().toISOString().slice(0, 10);
const FREQ_MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 } as const;

const daysIn = (y: number, m0: number): number => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** The date after `from` in this schedule. Months keep the day the schedule started on, shortened in short months (the 31st becomes the 28th, then the 31st again). */
export function nextOccurrence(from: string, frequency: RecurringRow['frequency'], anchorDay: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  if (frequency === 'weekly') { d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); }
  const months = FREQ_MONTHS[frequency as keyof typeof FREQ_MONTHS];
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const y = Math.floor(total / 12); const m0 = total % 12;
  return new Date(Date.UTC(y, m0, Math.min(anchorDay, daysIn(y, m0)))).toISOString().slice(0, 10);
}

/** Recurring invoices: rent, subscriptions, annual maintenance. Due occurrences are posted as ordinary invoices, each in its own transaction, so one failure never blocks the rest. */
@Injectable()
export class RecurringInvoicesService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(SalesInvoiceService) private readonly invoices: SalesInvoiceService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  create(tenantId: string, actorId: string, input: CreateRecurringInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, [...new Set(input.lines.map((l) => l.itemId))])));
      for (const [i, l] of input.lines.entries()) {
        const item = rows.find((r) => r.id === l.itemId);
        if (item && item.tracking !== 'none') throw validationFailed([{ path: `lines.${i}.itemId`, message: `${item.code} is batch or serial tracked: its batch or serial numbers are chosen at each sale, so it cannot recur` }]);
        if (item?.isStocked && !l.warehouseId) throw validationFailed([{ path: `lines.${i}.warehouseId`, message: `${item.code} is stocked: say which warehouse it leaves from` }]);
      }
      // validates registration, customer, items, tax and place of supply now, so a template is never un-invoiceable on day one
      await this.invoices.priceDocument(tx, tenantId, { companyId: input.companyId, gstRegistrationId: input.gstRegistrationId, businessLocationId: input.businessLocationId, documentType: input.documentType, customerId: input.customerId, reverseCharge: false, invoiceDate: input.startDate, lines: input.lines.map((l) => ({ ...l })) } as never, { requireWarehouse: true });
      const row = first(await tx.insert(recurringInvoices).values({
        tenantId, id: uuidv7(), companyId: input.companyId, name: input.name, gstRegistrationId: input.gstRegistrationId, businessLocationId: input.businessLocationId ?? null, customerId: input.customerId,
        documentType: input.documentType, frequency: input.frequency, anchorDay: Number(input.startDate.slice(8, 10)), startDate: input.startDate, endDate: input.endDate ?? null, nextRunDate: input.startDate,
        notes: input.notes ?? null, lines: input.lines.map((l) => ({ ...l })), createdBy: actorId,
      }).returning(), 'Recurring invoice');
      return this.recorder.record(tx, tenantId, 'recurring_invoice', 'created', row, { name: input.name, frequency: input.frequency });
    });
  }

  list(tenantId: string, q: { companyId: string; status?: string | undefined; limit: number }) {
    return this.uow.inTenant(tenantId, (tx) => tx.select().from(recurringInvoices).where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.companyId, q.companyId), q.status ? eq(recurringInvoices.status, q.status) : undefined)).orderBy(asc(recurringInvoices.nextRunDate)).limit(q.limit), { readOnly: true });
  }

  async get(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const recurring = first(await tx.select().from(recurringInvoices).where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.id, id))), 'Recurring invoice');
      const runs = await tx.select({ run: recurringInvoiceRuns, invoiceNo: salesInvoices.invoiceNo, total: salesInvoices.grandTotal }).from(recurringInvoiceRuns)
        .leftJoin(salesInvoices, and(eq(salesInvoices.tenantId, recurringInvoiceRuns.tenantId), eq(salesInvoices.id, recurringInvoiceRuns.invoiceId)))
        .where(and(eq(recurringInvoiceRuns.tenantId, tenantId), eq(recurringInvoiceRuns.recurringId, id))).orderBy(sql`${recurringInvoiceRuns.createdAt} DESC`).limit(50);
      return { recurring, runs: runs.map((r) => ({ ...r.run, tenantId: undefined, invoiceNo: r.invoiceNo, total: r.total })) };
    }, { readOnly: true });
  }

  setStatus(tenantId: string, id: string, status: 'active' | 'paused' | 'ended', endDate?: string | null) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = first(await tx.select().from(recurringInvoices).where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.id, id))).for('update'), 'Recurring invoice');
      if (r.status === 'ended') throw new AppError(409, 'already_ended', 'This schedule has ended');
      const set = { status, version: sql`${recurringInvoices.version} + 1`, updatedAt: new Date(), ...(endDate !== undefined ? { endDate } : {}) };
      const row = first(await tx.update(recurringInvoices).set(set).where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.id, id))).returning(), 'Recurring invoice');
      return this.recorder.record(tx, tenantId, 'recurring_invoice', status === 'active' ? 'resumed' : status, row, {});
    });
  }

  /** Posts every occurrence that is due on or before `asOf` (catching up on missed ones, at most 24 per schedule per run). */
  async runDue(tenantId: string, actorId: string, q: { companyId: string; asOf?: string | undefined }) {
    const asOf = q.asOf ?? today();
    const due = await this.uow.inTenant(tenantId, (tx) => tx.select({ id: recurringInvoices.id }).from(recurringInvoices)
      .where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.companyId, q.companyId), eq(recurringInvoices.status, 'active'), lte(recurringInvoices.nextRunDate, asOf))).limit(200), { readOnly: true });
    const generated: { recurringId: string; name: string; invoiceId: string; invoiceNo: string; date: string }[] = [];
    const failed: { recurringId: string; name: string; date: string; error: string }[] = [];
    for (const { id } of due) {
      for (let guard = 0; guard < 24; guard++) {
        let outcome: { done: true } | { posted: (typeof generated)[number] } | { stuck: { name: string; date: string; error: string } };
        try {
          outcome = await this.uow.inTenant(tenantId, async (tx) => {
            const r = first(await tx.select().from(recurringInvoices).where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.id, id))).for('update'), 'Recurring invoice');
            if (r.status !== 'active' || r.nextRunDate > asOf || (r.endDate && r.nextRunDate > r.endDate)) {
              if (r.status === 'active' && r.endDate && r.nextRunDate > r.endDate) await tx.update(recurringInvoices).set({ status: 'ended', updatedAt: new Date() }).where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.id, id)));
              return { done: true as const };
            }
            const date = r.nextRunDate;
            const posted = await this.invoices.postInvoice(tx, tenantId, actorId, {
              companyId: r.companyId, gstRegistrationId: r.gstRegistrationId, ...(r.businessLocationId ? { businessLocationId: r.businessLocationId } : {}), documentType: r.documentType as 'tax_invoice', invoiceDate: date, customerId: r.customerId, reverseCharge: false,
              lines: r.lines.map((l) => ({ ...l, discountPercent: l.discountPercent ?? '0', taxInclusive: l.taxInclusive ?? false })),
            } as never);
            await tx.insert(recurringInvoiceRuns).values({ tenantId, id: uuidv7(), recurringId: id, scheduledDate: date, status: 'posted', invoiceId: posted.invoice.id });
            const next = nextOccurrence(date, r.frequency, r.anchorDay);
            await tx.update(recurringInvoices).set({ lastRunDate: date, nextRunDate: next, runCount: r.runCount + 1, lastError: null, status: r.endDate && next > r.endDate ? 'ended' : 'active', version: sql`${recurringInvoices.version} + 1`, updatedAt: new Date() }).where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.id, id)));
            await this.recorder.record(tx, tenantId, 'recurring_invoice', 'ran', r, { invoiceNo: posted.invoice.invoiceNo, date });
            return { posted: { recurringId: id, name: r.name, invoiceId: posted.invoice.id, invoiceNo: posted.invoice.invoiceNo, date } };
          });
        } catch (e) {
          const error = e instanceof AppError || e instanceof Error ? e.message : 'Could not post the invoice';
          const info = await this.recordFailure(tenantId, id, error);
          failed.push({ recurringId: id, name: info.name, date: info.date, error });
          break;
        }
        if ('done' in outcome) break;
        if ('posted' in outcome) generated.push(outcome.posted);
      }
    }
    return { asOf, generated, failed };
  }

  /** Remembers why the last attempt failed, so the person sees it on the schedule; the occurrence stays due and is tried again next time. */
  private async recordFailure(tenantId: string, id: string, error: string): Promise<{ name: string; date: string }> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = first(await tx.select().from(recurringInvoices).where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.id, id))).for('update'), 'Recurring invoice');
      await tx.insert(recurringInvoiceRuns).values({ tenantId, id: uuidv7(), recurringId: id, scheduledDate: r.nextRunDate, status: 'failed', error: error.slice(0, 500) });
      await tx.update(recurringInvoices).set({ lastError: error.slice(0, 500), updatedAt: new Date() }).where(and(eq(recurringInvoices.tenantId, tenantId), eq(recurringInvoices.id, id)));
      return { name: r.name, date: r.nextRunDate };
    });
  }
}
