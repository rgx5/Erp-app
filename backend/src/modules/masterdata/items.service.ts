import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import type { Page } from '../../platform/http/validation.js';
import { first, likePrefix, pageOf, Recorder, updateVersioned } from './helpers.js';
import { itemUomConversions, items } from './masterdata.schema.js';
import type { CreateItemInput, ListItemsQuery, UpdateItemInput } from './masterdata.schemas.js';

export type ItemRow = typeof items.$inferSelect;
export type ConversionRow = typeof itemUomConversions.$inferSelect;

@Injectable()
export class ItemsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  create(tenantId: string, input: CreateItemInput): Promise<ItemRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'item', 'created', first(await tx.insert(items).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Item'), { code: input.code, itemType: input.itemType }),
    );
  }

  get(tenantId: string, id: string): Promise<ItemRow> {
    return this.uow.inTenant(tenantId, async (tx) => first(await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, id))), 'Item'), { readOnly: true });
  }

  list(tenantId: string, q: ListItemsQuery): Promise<Page<ItemRow>> {
    return this.uow.inTenant(
      tenantId,
      (tx) =>
        pageOf<ItemRow>(tx, items, tenantId, q.limit, q.cursor, q.itemType ? eq(items.itemType, q.itemType) : undefined, q.status ? eq(items.status, q.status) : undefined, q.q ? or(ilike(items.code, likePrefix(q.q)), ilike(items.name, likePrefix(q.q))) : undefined),
      { readOnly: true },
    );
  }

  /** Code, type and base unit are fixed at creation (the database enforces it): stock, costing and BOMs depend on them. */
  update(tenantId: string, id: string, version: number, input: UpdateItemInput): Promise<ItemRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'item', 'updated', await updateVersioned<ItemRow>(tx, items, tenantId, id, version, input, 'Item'), { fields: Object.keys(input) }),
    );
  }

  addConversion(tenantId: string, itemId: string, input: { uomId: string; factor: string }): Promise<ConversionRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const item = first(await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, itemId))), 'Item');
      return this.recorder.record(tx, tenantId, 'item_uom_conversion', 'created', first(await tx.insert(itemUomConversions).values({ tenantId, id: uuidv7(), itemId, ...input }).returning(), 'Conversion'), {
        itemId, itemCode: item.code, uomId: input.uomId, factor: input.factor,
      });
    });
  }

  listConversions(tenantId: string, itemId: string): Promise<ConversionRow[]> {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        first(await tx.select({ id: items.id }).from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, itemId))), 'Item');
        return tx.select().from(itemUomConversions).where(and(eq(itemUomConversions.tenantId, tenantId), eq(itemUomConversions.itemId, itemId)));
      },
      { readOnly: true },
    );
  }
}
