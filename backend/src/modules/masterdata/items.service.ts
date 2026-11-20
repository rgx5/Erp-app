import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import type { Page } from '../../platform/http/validation.js';
import { first, likeContains, likePrefix, pageOf, Recorder, updateVersioned } from './helpers.js';
import { itemBarcodes, itemCategories, itemUomConversions, items } from './masterdata.schema.js';
import type { CreateCategoryInput, CreateItemInput, ListItemsQuery, UpdateCategoryInput, UpdateItemInput } from './masterdata.schemas.js';
import { AppError } from '../../platform/http/errors.js';

export type ItemRow = typeof items.$inferSelect;
export type ConversionRow = typeof itemUomConversions.$inferSelect;
export type CategoryRow = typeof itemCategories.$inferSelect;
export type BarcodeRow = typeof itemBarcodes.$inferSelect;

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
        pageOf<ItemRow>(tx, items, tenantId, q.limit, q.cursor, q.itemType ? eq(items.itemType, q.itemType) : undefined, q.status ? eq(items.status, q.status) : undefined, q.q ? or(ilike(items.code, likePrefix(q.q)), ilike(items.name, likeContains(q.q)), ilike(items.styleCode, likePrefix(q.q))) : undefined),
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

  // ---- categories -------------------------------------------------------------------------------------------------
  createCategory(tenantId: string, input: CreateCategoryInput): Promise<CategoryRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      if (input.parentId) first(await tx.select({ id: itemCategories.id }).from(itemCategories).where(and(eq(itemCategories.tenantId, tenantId), eq(itemCategories.id, input.parentId))), 'Parent category');
      return this.recorder.record(tx, tenantId, 'item_category', 'created', first(await tx.insert(itemCategories).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Category'), { code: input.code });
    });
  }

  listCategories(tenantId: string, q: { limit: number; cursor?: string | undefined; status?: 'active' | 'inactive' | undefined }): Promise<Page<CategoryRow>> {
    return this.uow.inTenant(tenantId, (tx) => pageOf<CategoryRow>(tx, itemCategories, tenantId, q.limit, q.cursor, q.status ? eq(itemCategories.status, q.status) : undefined), { readOnly: true });
  }

  updateCategory(tenantId: string, id: string, version: number, input: UpdateCategoryInput): Promise<CategoryRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      if (input.parentId) {
        if (input.parentId === id) throw new AppError(422, 'category_cycle', 'A category cannot be its own parent');
        // walk up from the proposed parent: reaching this category would make a loop
        let cursor: string | null = input.parentId;
        for (let depth = 0; cursor && depth < 50; depth++) {
          const [row] = await tx.select().from(itemCategories).where(and(eq(itemCategories.tenantId, tenantId), eq(itemCategories.id, cursor)));
          if (!row) throw new AppError(404, 'not_found', 'Parent category not found');
          if (row.parentId === id) throw new AppError(422, 'category_cycle', 'That would make the category its own ancestor');
          cursor = row.parentId;
        }
      }
      return this.recorder.record(tx, tenantId, 'item_category', 'updated', await updateVersioned<CategoryRow>(tx, itemCategories, tenantId, id, version, input, 'Category'), { fields: Object.keys(input) });
    });
  }

  // ---- barcodes ---------------------------------------------------------------------------------------------------
  addBarcode(tenantId: string, itemId: string, barcode: string): Promise<BarcodeRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const item = first(await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, itemId))), 'Item');
      const [clash] = await tx.select().from(itemBarcodes).where(and(eq(itemBarcodes.tenantId, tenantId), sql`lower(${itemBarcodes.barcode}) = lower(${barcode})`));
      if (clash) throw new AppError(409, 'barcode_in_use', 'That barcode already belongs to an item', { itemId: clash.itemId });
      return this.recorder.record(tx, tenantId, 'item_barcode', 'created', first(await tx.insert(itemBarcodes).values({ tenantId, id: uuidv7(), itemId, barcode }).returning(), 'Barcode'), { itemCode: item.code, barcode });
    });
  }

  listBarcodes(tenantId: string, itemId: string): Promise<BarcodeRow[]> {
    return this.uow.inTenant(tenantId, (tx) => tx.select().from(itemBarcodes).where(and(eq(itemBarcodes.tenantId, tenantId), eq(itemBarcodes.itemId, itemId))), { readOnly: true });
  }

  setBarcodeStatus(tenantId: string, barcodeId: string, status: 'active' | 'inactive'): Promise<BarcodeRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'item_barcode', status === 'active' ? 'activated' : 'deactivated', first(await tx.update(itemBarcodes).set({ status }).where(and(eq(itemBarcodes.tenantId, tenantId), eq(itemBarcodes.id, barcodeId))).returning(), 'Barcode'), { status }),
    );
  }

  /** The counter's lookup: an active barcode wins; otherwise the item's own code (case-insensitive). Inactive items are not sold. */
  lookup(tenantId: string, code: string): Promise<{ item: ItemRow; matchedBy: 'barcode' | 'code'; noDiscount: boolean } | null> {
    return this.uow.inTenant(tenantId, async (tx) => {
      let item: ItemRow | undefined;
      let matchedBy: 'barcode' | 'code' = 'barcode';
      const [b] = await tx.select({ itemId: itemBarcodes.itemId }).from(itemBarcodes).where(and(eq(itemBarcodes.tenantId, tenantId), eq(itemBarcodes.status, 'active'), sql`lower(${itemBarcodes.barcode}) = lower(${code})`));
      if (b) [item] = await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, b.itemId)));
      if (!item) { matchedBy = 'code'; [item] = await tx.select().from(items).where(and(eq(items.tenantId, tenantId), sql`lower(${items.code}) = lower(${code})`)); }
      if (!item || item.status !== 'active') return null;
      let noDiscount = false;
      for (let id: string | null = item.categoryId, depth = 0; id && depth < 50 && !noDiscount; depth++) {
        const [c] = await tx.select().from(itemCategories).where(and(eq(itemCategories.tenantId, tenantId), eq(itemCategories.id, id)));
        noDiscount = c?.noDiscount === true;
        id = c?.parentId ?? null;
      }
      return { item, matchedBy, noDiscount };
    }, { readOnly: true });
  }
}
