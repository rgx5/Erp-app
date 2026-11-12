import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, notFound } from '../../platform/http/errors.js';
import { decodeCursor, type Page, toPage } from '../../platform/http/validation.js';
import { AuditService } from '../../platform/services/audit.service.js';
import { numberAllocations, numberSeries } from '../../platform/services/platform.schema.js';

export type SeriesRow = typeof numberSeries.$inferSelect;
export type AllocationRow = typeof numberAllocations.$inferSelect;

export interface CreateSeriesInput {
  gstRegistrationId: string;
  documentType: string;
  financialYear: string;
  prefix: string;
  separator: '/' | '-' | '';
  includeFinancialYear: boolean;
  padding: number;
  startAt: number;
}

/** GST invoice numbers are at most 16 characters of letters, digits, "/" and "-" (CGST Rules, rule 46). */
export const MAX_NUMBER_LENGTH = 16;

/**
 * The statutory financial year for a date, as `2024-25`. India's GST year runs April-March. This is a fixed rule of the
 * numbering scheme, not the company's books year (which a company may configure differently).
 */
export function financialYearOf(date: Date): string {
  const year = date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

export function formatNumber(series: Pick<SeriesRow, 'prefix' | 'separator' | 'includeFinancialYear' | 'padding' | 'financialYear'>, value: number): string {
  const parts: string[] = [];
  if (series.prefix) parts.push(series.prefix);
  if (series.includeFinancialYear) parts.push(series.financialYear.slice(2, 4) + series.financialYear.slice(5, 7));
  parts.push(String(value).padStart(series.padding, '0'));
  return parts.join(series.separator);
}

/**
 * Document numbering. One series per GST registration x document type x financial year; there is no global counter.
 * Allocation runs in the CALLER's transaction and holds the series row lock until it commits, so a number is consumed if and
 * only if the document using it is saved. Issued numbers are kept forever: cancelling marks the number cancelled but it is
 * never reused.
 */
@Injectable()
export class NumberingService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  createSeries(tenantId: string, input: CreateSeriesInput): Promise<SeriesRow> {
    // The widest number this series can ever produce must still be a legal invoice number.
    const widest = formatNumber({ ...input }, 10 ** input.padding - 1);
    if (widest.length > MAX_NUMBER_LENGTH) {
      throw new AppError(422, 'number_too_long', `This format can produce numbers longer than ${MAX_NUMBER_LENGTH} characters (e.g. ${widest}); shorten the prefix or padding`);
    }
    return this.uow.inTenant(tenantId, async (tx) => {
      const [row] = await tx
        .insert(numberSeries)
        .values({ tenantId, id: uuidv7(), ...input, nextValue: input.startAt })
        .returning();
      if (!row) throw new Error('insert returned no row');
      await this.audit.record(tx, tenantId, { action: 'number_series.created', entityType: 'number_series', entityId: row.id, details: { documentType: row.documentType, financialYear: row.financialYear, gstRegistrationId: row.gstRegistrationId } });
      return row;
    });
  }

  /**
   * Takes the next number from the series for this registration, document type and financial year. MUST be called inside the
   * transaction that saves the document (`uow.inTenant` joins it), so the number and the document commit or roll back together.
   */
  async allocate(
    tx: Tx,
    tenantId: string,
    scope: { gstRegistrationId: string; documentType: string; financialYear: string; documentRef?: string },
  ): Promise<AllocationRow> {
    const [series] = await tx
      .select()
      .from(numberSeries)
      .where(
        and(
          eq(numberSeries.tenantId, tenantId),
          eq(numberSeries.gstRegistrationId, scope.gstRegistrationId),
          eq(numberSeries.documentType, scope.documentType),
          eq(numberSeries.financialYear, scope.financialYear),
        ),
      )
      .for('update'); // serialises allocations of this series only; other series and tenants are unaffected
    if (!series) throw new AppError(409, 'number_series_missing', `No ${scope.documentType} number series exists for ${scope.financialYear} on this GST registration`);
    if (series.status !== 'active') throw new AppError(409, 'number_series_closed', 'This number series is closed');
    const formatted = formatNumber(series, series.nextValue);
    if (formatted.length > MAX_NUMBER_LENGTH) throw new AppError(409, 'number_series_exhausted', 'This series has run out of numbers that fit the 16-character limit');
    const [allocation] = await tx
      .insert(numberAllocations)
      .values({ tenantId, id: uuidv7(), seriesId: series.id, value: series.nextValue, formatted, documentRef: scope.documentRef ?? null })
      .returning();
    await tx.update(numberSeries).set({ nextValue: series.nextValue + 1 }).where(and(eq(numberSeries.tenantId, tenantId), eq(numberSeries.id, series.id)));
    if (!allocation) throw new Error('insert returned no row');
    return allocation;
  }

  /** Marks an issued number cancelled. The number stays on record and is never issued again. */
  async cancel(tx: Tx, tenantId: string, allocationId: string, reason: string): Promise<AllocationRow> {
    const [existing] = await tx.select().from(numberAllocations).where(and(eq(numberAllocations.tenantId, tenantId), eq(numberAllocations.id, allocationId))).for('update');
    if (!existing) throw notFound('Number allocation');
    if (existing.status === 'cancelled') return existing; // cancelling twice is harmless
    const [updated] = await tx
      .update(numberAllocations)
      .set({ status: 'cancelled', cancelReason: reason, cancelledAt: new Date() })
      .where(and(eq(numberAllocations.tenantId, tenantId), eq(numberAllocations.id, allocationId)))
      .returning();
    await this.audit.record(tx, tenantId, { action: 'number.cancelled', entityType: 'number_allocation', entityId: allocationId, details: { formatted: existing.formatted, reason } });
    if (!updated) throw new Error('update returned no row');
    return updated;
  }

  getSeries(tenantId: string, id: string): Promise<SeriesRow> {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const [row] = await tx.select().from(numberSeries).where(and(eq(numberSeries.tenantId, tenantId), eq(numberSeries.id, id)));
        if (!row) throw notFound('Number series');
        return row;
      },
      { readOnly: true },
    );
  }

  listSeries(tenantId: string, limit: number, cursor: string | undefined): Promise<Page<SeriesRow>> {
    const after = decodeCursor(cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => toPage(await tx.select().from(numberSeries).where(and(eq(numberSeries.tenantId, tenantId), after ? gt(numberSeries.id, after) : undefined)).orderBy(asc(numberSeries.id)).limit(limit + 1), limit),
      { readOnly: true },
    );
  }

  listAllocations(tenantId: string, seriesId: string, limit: number, cursor: string | undefined): Promise<Page<AllocationRow>> {
    const after = decodeCursor(cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) =>
        toPage(
          await tx
            .select()
            .from(numberAllocations)
            .where(and(eq(numberAllocations.tenantId, tenantId), eq(numberAllocations.seriesId, seriesId), after ? gt(numberAllocations.id, after) : undefined))
            .orderBy(asc(numberAllocations.id))
            .limit(limit + 1),
          limit,
        ),
      { readOnly: true },
    );
  }
}
