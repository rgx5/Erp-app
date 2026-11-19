import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { AppError } from '../../platform/http/errors.js';
import { fiscalYears } from '../accounting/accounting.schema.js';
import { stockCounters } from '../inventory/inventory.schema.js';

/**
 * Internal (non-statutory) document numbers, per company x fiscal year x prefix, e.g. `QT/2526/000001`. Taken inside the caller's
 * transaction so a rolled-back document returns its number. (Shares the counter table the stock documents use, so prefixes must never collide with theirs: SO SR SI SA TD TR TX SC TF CN.)
 */
export async function nextDocNumber(tx: Tx, tenantId: string, companyId: string, date: string, prefix: string): Promise<string> {
  const code = await siteSeriesCode(tx, tenantId);
  prefix = `${prefix}${code}`;
  const [year] = await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.companyId, companyId), sql`${fiscalYears.startDate} <= ${date}::date AND ${fiscalYears.endDate} >= ${date}::date`));
  if (!year) throw new AppError(409, 'no_accounting_period', `No fiscal year covers ${date}`);
  const [counter] = await tx
    .insert(stockCounters)
    .values({ tenantId, companyId, fiscalYearId: year.id, prefix, nextValue: 2 })
    .onConflictDoUpdate({ target: [stockCounters.tenantId, stockCounters.companyId, stockCounters.fiscalYearId, stockCounters.prefix], set: { nextValue: sql`${stockCounters.nextValue} + 1` } })
    .returning({ next: stockCounters.nextValue });
  return `${prefix}/${year.startDate.slice(2, 4)}${year.endDate.slice(2, 4)}/${String((counter?.next ?? 2) - 1).padStart(6, '0')}`;
}

/** The series code of the site this server runs at, added to document-number prefixes so two sites never issue the same number. '' for the primary site. */
export async function siteSeriesCode(tx: Tx, tenantId: string): Promise<string> {
  const r = await tx.execute<{ site: string | null; series_code: string | null }>(sql`SELECT erp.current_site_id() AS site, (SELECT s.series_code FROM erp.sites s WHERE s.tenant_id = ${tenantId}::uuid AND s.id = erp.current_site_id()) AS series_code`);
  const row = r.rows[0];
  if (row?.site && row.series_code == null) throw new AppError(409, 'unknown_site', 'This server is set up for a site that does not exist for this business');
  return row?.series_code ?? '';
}
