import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, notFound } from '../../platform/http/errors.js';
import type { Page } from '../../platform/http/validation.js';
import { first, pageOf, Recorder, updateVersioned } from './helpers.js';
import { priceListItems, priceLists } from './masterdata.schema.js';
import type { CreatePriceInput, CreatePriceListInput, UpdatePriceListInput } from './masterdata.schemas.js';

export type PriceListRow = typeof priceLists.$inferSelect;
export type PriceRow = typeof priceListItems.$inferSelect;

@Injectable()
export class PricingService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  createList(tenantId: string, input: CreatePriceListInput): Promise<PriceListRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'price_list', 'created', first(await tx.insert(priceLists).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Price list'), { code: input.code, kind: input.kind }),
    );
  }
  getList(tenantId: string, id: string): Promise<PriceListRow> {
    return this.uow.inTenant(tenantId, async (tx) => first(await tx.select().from(priceLists).where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id))), 'Price list'), { readOnly: true });
  }
  listLists(tenantId: string, limit: number, cursor?: string): Promise<Page<PriceListRow>> {
    return this.uow.inTenant(tenantId, (tx) => pageOf<PriceListRow>(tx, priceLists, tenantId, limit, cursor), { readOnly: true });
  }
  updateList(tenantId: string, id: string, version: number, input: UpdatePriceListInput): Promise<PriceListRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'price_list', 'updated', await updateVersioned<PriceListRow>(tx, priceLists, tenantId, id, version, input, 'Price list'), { fields: Object.keys(input) }),
    );
  }

  /** Adds a price. Periods for the same list/item/unit/minimum-quantity cannot overlap (409); to change a price, close the old row and add a new one. */
  addPrice(tenantId: string, priceListId: string, input: CreatePriceInput): Promise<PriceRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      first(await tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, priceListId))), 'Price list');
      return this.recorder.record(tx, tenantId, 'price', 'created', first(await tx.insert(priceListItems).values({ tenantId, id: uuidv7(), priceListId, ...input }).returning(), 'Price'), {
        priceListId, itemId: input.itemId, price: input.price, effectiveFrom: input.effectiveFrom,
      });
    });
  }
  closePrice(tenantId: string, priceListId: string, priceId: string, effectiveTo: string): Promise<PriceRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(priceListItems).where(and(eq(priceListItems.tenantId, tenantId), eq(priceListItems.priceListId, priceListId), eq(priceListItems.id, priceId)));
      if (!row) throw notFound('Price');
      if (row.effectiveTo) throw new AppError(409, 'already_closed', 'This price is already closed');
      if (effectiveTo < row.effectiveFrom) throw new AppError(422, 'validation_failed', 'effectiveTo cannot be before effectiveFrom');
      const [closed] = await tx.update(priceListItems).set({ effectiveTo }).where(and(eq(priceListItems.tenantId, tenantId), eq(priceListItems.id, priceId))).returning();
      return this.recorder.record(tx, tenantId, 'price', 'closed', first(closed ? [closed] : [], 'Price'), { priceListId, effectiveTo });
    });
  }
  listPrices(tenantId: string, priceListId: string, limit: number, cursor: string | undefined, itemId?: string): Promise<Page<PriceRow>> {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        first(await tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, priceListId))), 'Price list');
        return pageOf<PriceRow>(tx, priceListItems, tenantId, limit, cursor, eq(priceListItems.priceListId, priceListId), itemId ? eq(priceListItems.itemId, itemId) : undefined);
      },
      { readOnly: true },
    );
  }

  /**
   * The price for a quantity on a date: among rows in force on that date whose minimum quantity the order reaches, the one with
   * the highest minimum (quantity breaks). Documents call this with their own date and quantity.
   */
  async priceOn(tx: Tx, tenantId: string, q: { priceListId: string; itemId: string; uomId: string; qty: string; date: string }): Promise<PriceRow> {
    const [row] = await tx
      .select()
      .from(priceListItems)
      .where(
        and(
          eq(priceListItems.tenantId, tenantId),
          eq(priceListItems.priceListId, q.priceListId),
          eq(priceListItems.itemId, q.itemId),
          eq(priceListItems.uomId, q.uomId),
          lte(priceListItems.minQty, q.qty),
          lte(priceListItems.effectiveFrom, q.date),
          or(isNull(priceListItems.effectiveTo), gte(priceListItems.effectiveTo, q.date)),
        ),
      )
      .orderBy(desc(priceListItems.minQty))
      .limit(1);
    if (!row) throw new AppError(404, 'price_missing', `No price is in force for this item on ${q.date} at quantity ${q.qty}`);
    return row;
  }
  resolve(tenantId: string, q: { priceListId: string; itemId: string; uomId: string; qty: string; date: string }): Promise<PriceRow> {
    return this.uow.inTenant(tenantId, (tx) => this.priceOn(tx, tenantId, q), { readOnly: true });
  }
}
