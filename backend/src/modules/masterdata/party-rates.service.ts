import { Controller, Get, Inject, Injectable, Param, Post, Put, Query, Body, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from './helpers.js';

const id = z.uuid();
const money = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'An amount such as 1500 or 1500.50');
export const setRateSchema = z.strictObject({ itemId: id, rate: money, taxInclusive: z.boolean().default(false) });
export const suggestQuery = z.object({ itemId: id, kind: z.enum(['sales', 'purchase']).default('sales'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export interface RateRow { id: string; partyId: string; itemId: string; itemCode: string; itemName: string; rate: string; taxInclusive: boolean }
export interface Suggestion { source: 'party' | 'last' | 'list' | 'none'; price: string | null; taxInclusive: boolean }

@Injectable()
export class PartyRatesService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(Recorder) private readonly recorder: Recorder) {}

  list(tenantId: string, partyId: string): Promise<RateRow[]> {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.execute<{ id: string; party_id: string; item_id: string; code: string; name: string; rate: string; tax_inclusive: boolean }>(sql`
      SELECT r.id, r.party_id, r.item_id, i.code, i.name, r.rate::text, r.tax_inclusive FROM erp.party_item_rates r JOIN erp.items i ON i.tenant_id = r.tenant_id AND i.id = r.item_id
       WHERE r.tenant_id = ${tenantId}::uuid AND r.party_id = ${partyId}::uuid AND r.status = 'active' ORDER BY i.name`)).rows.map((r) => ({ id: r.id, partyId: r.party_id, itemId: r.item_id, itemCode: r.code, itemName: r.name, rate: r.rate, taxInclusive: r.tax_inclusive })), { readOnly: true });
  }

  /** Sets (or changes) the rate agreed with a party for an item. */
  set(tenantId: string, actorId: string, partyId: string, input: z.infer<typeof setRateSchema>): Promise<RateRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const party = (await tx.execute<{ id: string }>(sql`SELECT id FROM erp.parties WHERE tenant_id = ${tenantId}::uuid AND id = ${partyId}::uuid`)).rows[0];
      const item = (await tx.execute<{ id: string; code: string; name: string }>(sql`SELECT id, code, name FROM erp.items WHERE tenant_id = ${tenantId}::uuid AND id = ${input.itemId}::uuid`)).rows[0];
      if (!party) throw new AppError(404, 'not_found', 'Party was not found');
      if (!item) throw new AppError(404, 'not_found', 'Item was not found');
      const rid = uuidv7();
      const row = (await tx.execute<{ id: string }>(sql`
        INSERT INTO erp.party_item_rates (tenant_id, id, party_id, item_id, rate, tax_inclusive, created_by) VALUES (${tenantId}::uuid, ${rid}::uuid, ${partyId}::uuid, ${input.itemId}::uuid, ${input.rate}::numeric, ${input.taxInclusive}, ${actorId}::uuid)
        ON CONFLICT (tenant_id, party_id, item_id) DO UPDATE SET rate = EXCLUDED.rate, tax_inclusive = EXCLUDED.tax_inclusive, status = 'active', updated_at = now() RETURNING id`)).rows[0] as { id: string };
      await this.recorder.record(tx, tenantId, 'party_item_rate', 'set', { id: row.id }, { partyId, itemId: input.itemId, rate: input.rate });
      return { id: row.id, partyId, itemId: item.id, itemCode: item.code, itemName: item.name, rate: input.rate, taxInclusive: input.taxInclusive };
    });
  }

  remove(tenantId: string, partyId: string, rateId: string): Promise<{ ok: true }> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = await tx.execute(sql`UPDATE erp.party_item_rates SET status = 'inactive', updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${rateId}::uuid AND party_id = ${partyId}::uuid AND status = 'active'`);
      if (r.rowCount === 0) throw new AppError(404, 'not_found', 'That rate was not found');
      await this.recorder.record(tx, tenantId, 'party_item_rate', 'removed', { id: rateId }, { partyId });
      return { ok: true as const };
    });
  }

  /** The price to start from: the rate agreed with this party, else what they were last charged, else the first active price list that has the item. */
  suggest(tenantId: string, partyId: string, q: z.infer<typeof suggestQuery>): Promise<Suggestion> {
    const date = q.date ?? new Date().toISOString().slice(0, 10);
    return this.uow.inTenant(tenantId, async (tx) => {
      const own = (await tx.execute<{ rate: string; tax_inclusive: boolean }>(sql`SELECT rate::text, tax_inclusive FROM erp.party_item_rates WHERE tenant_id = ${tenantId}::uuid AND party_id = ${partyId}::uuid AND item_id = ${q.itemId}::uuid AND status = 'active'`)).rows[0];
      if (own) return { source: 'party' as const, price: own.rate, taxInclusive: own.tax_inclusive };
      const last = q.kind === 'sales'
        ? (await tx.execute<{ p: string; inc: boolean }>(sql`SELECT l.unit_price::text AS p, l.tax_inclusive AS inc FROM erp.sales_invoice_lines l JOIN erp.sales_invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
            WHERE l.tenant_id = ${tenantId}::uuid AND i.customer_id = ${partyId}::uuid AND l.item_id = ${q.itemId}::uuid AND i.status = 'posted' AND i.document_type IN ('tax_invoice', 'bill_of_supply') ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT 1`)).rows[0]
        : (await tx.execute<{ p: string; inc: boolean }>(sql`SELECT l.unit_price::text AS p, false AS inc FROM erp.supplier_bill_lines l JOIN erp.supplier_bills b ON b.tenant_id = l.tenant_id AND b.id = l.bill_id
            WHERE l.tenant_id = ${tenantId}::uuid AND b.supplier_id = ${partyId}::uuid AND l.item_id = ${q.itemId}::uuid AND b.status = 'posted' AND b.document_type = 'bill' ORDER BY b.bill_date DESC, b.created_at DESC LIMIT 1`)).rows[0];
      if (last) return { source: 'last' as const, price: last.p, taxInclusive: last.inc };
      const list = (await tx.execute<{ p: string; inc: boolean }>(sql`SELECT pi.price::text AS p, pl.tax_inclusive AS inc FROM erp.price_list_items pi JOIN erp.price_lists pl ON pl.tenant_id = pi.tenant_id AND pl.id = pi.price_list_id
            WHERE pi.tenant_id = ${tenantId}::uuid AND pi.item_id = ${q.itemId}::uuid AND pl.kind = ${q.kind} AND pl.status = 'active' AND pi.min_qty <= 1 AND pi.effective_from <= ${date}::date AND (pi.effective_to IS NULL OR pi.effective_to >= ${date}::date)
            ORDER BY pi.effective_from DESC LIMIT 1`)).rows[0];
      return list ? { source: 'list' as const, price: list.p, taxInclusive: list.inc } : { source: 'none' as const, price: null, taxInclusive: false };
    }, { readOnly: true });
  }
}

@ApiTags('party-rates')
@ApiBearerAuth()
@Controller('v1/parties/:id')
export class PartyRatesController {
  constructor(@Inject(PartyRatesService) private readonly rates: PartyRatesService) {}
  @RequirePermissions('masterdata:read') @Get('item-rates')
  async list(@TenantId() t: string, @Param('id', { schema: id }) partyId: string) { return { items: await this.rates.list(t, partyId) }; }
  /** Agrees a rate with this party for an item (replaces the previous one). */
  @RequirePermissions('pricing:manage') @Put('item-rates') @ApiZodBody(setRateSchema)
  set(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) partyId: string, @Body({ schema: setRateSchema }) b: z.infer<typeof setRateSchema>) { return this.rates.set(a.tenantId, a.userId, partyId, b); }
  @RequirePermissions('pricing:manage') @HttpCode(200) @Post('item-rates/:rateId/remove')
  remove(@TenantId() t: string, @Param('id', { schema: id }) partyId: string, @Param('rateId', { schema: id }) rateId: string) { return this.rates.remove(t, partyId, rateId); }
  /** The price to start from for this party and item. */
  @RequirePermissions('masterdata:read') @Get('suggested-price')
  suggest(@TenantId() t: string, @Param('id', { schema: id }) partyId: string, @Query({ schema: suggestQuery }) q: z.infer<typeof suggestQuery>) { return this.rates.suggest(t, partyId, q); }
}
