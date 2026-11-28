import { Controller, Get, Inject, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { fromUnits, toUnits } from '../accounting/money.js';
import { RequiresModule } from '../identity/entitlements.js';
import { CurrentPrincipal, type Principal, RequirePermissions } from '../identity/principal.js';
import { inrUnitsOf, toPaiseUnits } from '../sales/fx.logic.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const exposureQuery = z.object({ companyId: z.uuid(), asOf: isoDate });

type Row = { id: string; invoice_no: string; invoice_date: string; customer_id: string; customer_name: string; currency: string; exchange_rate: string; grand_total: string; foreign_total: string; outstanding: string };

/**
 * Money owed to us in foreign currencies, valued at today's rate. Nothing is posted: the gain or loss shown is *unrealised*, and becomes real (and
 * is booked) only when the customer pays and the receipt is settled against the invoice.
 */
@Injectable()
export class FxService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork) {}

  exposure(tenantId: string, q: z.infer<typeof exposureQuery>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = (await tx.execute<Row>(sql`
        SELECT i.id, i.invoice_no, i.invoice_date::text, i.customer_id, i.customer_name, i.currency, i.exchange_rate::text, i.grand_total::text, i.foreign_total::text,
               (i.grand_total - COALESCE((SELECT sum(a.amount) FROM erp.receivable_allocations a WHERE a.tenant_id = i.tenant_id AND a.invoice_id = i.id AND a.reversed_at IS NULL), 0))::text AS outstanding
          FROM erp.sales_invoices i
         WHERE i.tenant_id = ${tenantId}::uuid AND i.company_id = ${q.companyId}::uuid AND i.currency <> 'INR' AND i.status = 'posted' AND i.document_type IN ('tax_invoice', 'bill_of_supply') AND i.invoice_date <= ${q.asOf}::date
         ORDER BY i.invoice_date, i.invoice_no`)).rows;
      const rates = new Map<string, string | null>();
      const items = [];
      for (const r of rows) {
        const out = toUnits(r.outstanding);
        if (out <= 0n) continue;
        if (!rates.has(r.currency)) rates.set(r.currency, (await tx.execute<{ rate: string }>(sql`SELECT rate::text FROM erp.exchange_rates WHERE tenant_id = ${tenantId}::uuid AND from_currency = ${r.currency} AND to_currency = 'INR' AND effective_date <= ${q.asOf}::date ORDER BY effective_date DESC LIMIT 1`)).rows[0]?.rate ?? null);
        const rate = rates.get(r.currency) ?? null;
        const grand = toUnits(r.grand_total); const foreignOut = (toUnits(r.foreign_total) * out * 2n + grand) / (2n * grand);
        const revalued = rate ? toPaiseUnits(inrUnitsOf(foreignOut, rate)) : null;
        items.push({ id: r.id, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, customerId: r.customer_id, customerName: r.customer_name, currency: r.currency, bookedRate: r.exchange_rate.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''), foreignOutstanding: fromUnits(foreignOut), bookedValue: fromUnits(out), rate, currentValue: revalued === null ? null : fromUnits(revalued), unrealised: revalued === null ? null : fromUnits(revalued - out) });
      }
      const byCurrency = new Map<string, { foreign: bigint; booked: bigint; current: bigint; missingRate: boolean }>();
      for (const it of items) {
        const c = byCurrency.get(it.currency) ?? { foreign: 0n, booked: 0n, current: 0n, missingRate: false };
        c.foreign += toUnits(it.foreignOutstanding); c.booked += toUnits(it.bookedValue);
        if (it.currentValue === null) c.missingRate = true; else c.current += toUnits(it.currentValue);
        byCurrency.set(it.currency, c);
      }
      return {
        asOf: q.asOf, items,
        totals: [...byCurrency].map(([currency, c]) => ({ currency, foreignOutstanding: fromUnits(c.foreign), bookedValue: fromUnits(c.booked), currentValue: c.missingRate ? null : fromUnits(c.current), unrealised: c.missingRate ? null : fromUnits(c.current - c.booked) })),
      };
    }, { readOnly: true });
  }
}

@ApiTags('fx')
@ApiBearerAuth()
@RequiresModule('sales')
@Controller('v1/fx')
export class FxController {
  constructor(@Inject(FxService) private readonly svc: FxService) {}
  /** Foreign-currency invoices still unpaid, valued at the rate in force on `asOf`. */
  @RequirePermissions('receivables:read') @Get('exposure') exposure(@CurrentPrincipal() a: Principal, @Query({ schema: exposureQuery }) q: z.infer<typeof exposureQuery>) { return this.svc.exposure(a.tenantId, q); }
}

@Module({ controllers: [FxController], providers: [FxService] })
export class FxModule {}
