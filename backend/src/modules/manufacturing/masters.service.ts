import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, lte, or, sql, isNull, gte } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { divRound, qty } from '../inventory/decimal.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { items } from '../masterdata/masterdata.schema.js';
import { nextDocNumber } from '../sales/doc-number.js';
import { bomLines, bomOperations, boms, workCentres } from './manufacturing.schema.js';
import type { CreateBomInput, CreateWorkCentreInput, UpdateWorkCentreInput } from './manufacturing.schemas.js';

export type WorkCentreRow = typeof workCentres.$inferSelect;
export type BomRow = typeof boms.$inferSelect;
export type BomLineRow = typeof bomLines.$inferSelect;
export type BomOperationRow = typeof bomOperations.$inferSelect;

const SCRAP_ONE = 1_000_000n; // 100% in 4-decimal percent units
const scrapUnits = (text: string): bigint => { const [i = '0', f = ''] = text.split('.'); return BigInt(i) * 10_000n + BigInt(f.padEnd(4, '0').slice(0, 4)); };
/** Quantity of a component needed to make `target` units from a BOM of `base`: line x target / base, grossed up for scrap. */
export const requirement = (lineQty: string, scrapPercent: string, target: bigint, base: bigint): bigint => divRound(divRound(qty.parse(lineQty) * target, base) * SCRAP_ONE, SCRAP_ONE - scrapUnits(scrapPercent));

export interface ExplodedNode { itemId: string; itemCode: string; quantity: string; bomId: string | null; children: ExplodedNode[] }

/** Work centres and bills of materials: the manufacturing master data. */
@Injectable()
export class ManufacturingMastersService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- work centres ----------------------------------------------------------------------------------------------------
  createWorkCentre(tenantId: string, input: CreateWorkCentreInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const row = first(await tx.insert(workCentres).values({ tenantId, id: uuidv7(), companyId: input.companyId, code: input.code, name: input.name, labourRatePerHour: input.labourRatePerHour, machineRatePerHour: input.machineRatePerHour, overheadRatePerHour: input.overheadRatePerHour }).returning(), 'Work centre');
      await this.recorder.record(tx, tenantId, 'work_centre', 'created', row, { code: row.code });
      return row;
    });
  }
  updateWorkCentre(tenantId: string, id: string, input: UpdateWorkCentreInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [cur] = await tx.select().from(workCentres).where(and(eq(workCentres.tenantId, tenantId), eq(workCentres.id, id))).for('update');
      if (!cur) throw new AppError(404, 'not_found', 'Work centre not found');
      const row = first(await tx.update(workCentres).set(input).where(and(eq(workCentres.tenantId, tenantId), eq(workCentres.id, id))).returning(), 'Work centre');
      await this.recorder.record(tx, tenantId, 'work_centre', 'updated', row, { fields: Object.keys(input) });
      return row;
    });
  }
  getWorkCentre(tenantId: string, id: string) { return this.uow.inTenant(tenantId, async (tx) => first(await tx.select().from(workCentres).where(and(eq(workCentres.tenantId, tenantId), eq(workCentres.id, id))), 'Work centre'), { readOnly: true }); }
  listWorkCentres(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(workCentres).where(and(eq(workCentres.tenantId, tenantId), eq(workCentres.companyId, q.companyId), before ? lt(workCentres.id, before) : undefined, q.status ? eq(workCentres.status, q.status) : undefined)).orderBy(desc(workCentres.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }

  // ---- bills of materials ----------------------------------------------------------------------------------------------
  createBom(tenantId: string, actorId: string, input: CreateBomInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const ids = [...new Set([input.itemId, ...input.lines.map((l) => l.itemId)])];
      const itemRows = new Map((await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, ids)))).map((i) => [i.id, i]));
      const parent = itemRows.get(input.itemId);
      if (!parent || parent.status !== 'active' || !parent.isStocked || !['semi_finished', 'finished_good'].includes(parent.itemType)) throw validationFailed([{ path: 'itemId', message: 'A BOM is for an active, stocked semi-finished or finished item' }]);
      input.lines.forEach((l, i) => {
        const c = itemRows.get(l.itemId);
        if (!c || c.status !== 'active' || !c.isStocked) throw validationFailed([{ path: `lines.${i}.itemId`, message: 'A component must be an active, stocked item' }]);
        if (c.id === parent.id) throw validationFailed([{ path: `lines.${i}.itemId`, message: 'An item cannot be a component of itself' }]);
      });
      if (new Set(input.lines.map((l) => l.itemId)).size !== input.lines.length) throw validationFailed([{ path: 'lines', message: 'A component appears twice; combine its quantities' }]);
      if (new Set(input.operations.map((o) => o.opNo)).size !== input.operations.length) throw validationFailed([{ path: 'operations', message: 'An operation number appears twice' }]);
      const wcIds = [...new Set(input.operations.map((o) => o.workCentreId))];
      const wcs = wcIds.length > 0 ? await tx.select().from(workCentres).where(and(eq(workCentres.tenantId, tenantId), eq(workCentres.companyId, input.companyId), inArray(workCentres.id, wcIds))) : [];
      input.operations.forEach((o, i) => { const w = wcs.find((x) => x.id === o.workCentreId); if (!w || w.status !== 'active') throw validationFailed([{ path: `operations.${i}.workCentreId`, message: 'An active work centre of this company is needed' }]); });
      await this.assertNoCycle(tx, tenantId, input.companyId, input.itemId, input.lines.map((l) => l.itemId));

      const [{ v } = { v: 0 }] = await tx.select({ v: sql<number>`COALESCE(MAX(${boms.version}), 0)::int` }).from(boms).where(and(eq(boms.tenantId, tenantId), eq(boms.companyId, input.companyId), eq(boms.itemId, input.itemId)));
      const bomNo = await nextDocNumber(tx, tenantId, input.companyId, input.effectiveFrom, 'BOM');
      const bom = first(await tx.insert(boms).values({ tenantId, id: uuidv7(), companyId: input.companyId, itemId: input.itemId, bomNo, version: v + 1, description: input.description ?? null, baseQuantity: input.baseQuantity, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, createdBy: actorId }).returning(), 'BOM');
      const lines = await tx.insert(bomLines).values(input.lines.map((l, i) => ({ tenantId, id: uuidv7(), bomId: bom.id, lineNo: i + 1, itemId: l.itemId, quantity: l.quantity, scrapPercent: l.scrapPercent, notes: l.notes ?? null }))).returning();
      const operations = input.operations.length > 0 ? await tx.insert(bomOperations).values([...input.operations].sort((a, b) => a.opNo - b.opNo).map((o) => ({ tenantId, id: uuidv7(), bomId: bom.id, opNo: o.opNo, name: o.name, workCentreId: o.workCentreId, setupHours: o.setupHours, runHours: o.runHours }))).returning() : [];
      await this.recorder.record(tx, tenantId, 'bom', 'created', bom, { bomNo, itemId: input.itemId, version: bom.version, lines: lines.length });
      return { bom, lines, operations };
    });
  }

  /** Marks a BOM obsolete so a newer version can take its place (its history stays). */
  obsoleteBom(tenantId: string, id: string, effectiveTo?: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const bom = first(await tx.select().from(boms).where(and(eq(boms.tenantId, tenantId), eq(boms.id, id))).for('update'), 'BOM');
      if (bom.status === 'obsolete') throw new AppError(409, 'already_obsolete', 'This BOM is already obsolete');
      if (effectiveTo && effectiveTo < bom.effectiveFrom) throw validationFailed([{ path: 'effectiveTo', message: 'Cannot be before the BOM starts' }]);
      const updated = first(await tx.update(boms).set({ status: 'obsolete', ...(effectiveTo ? { effectiveTo } : {}) }).where(and(eq(boms.tenantId, tenantId), eq(boms.id, id))).returning(), 'BOM');
      await this.recorder.record(tx, tenantId, 'bom', 'obsoleted', updated, { bomNo: updated.bomNo });
      return this.read(tx, tenantId, id);
    });
  }

  getBom(tenantId: string, id: string) { return this.uow.inTenant(tenantId, (tx) => this.read(tx, tenantId, id), { readOnly: true }); }
  private async read(tx: Tx, tenantId: string, id: string) {
    return {
      bom: first(await tx.select().from(boms).where(and(eq(boms.tenantId, tenantId), eq(boms.id, id))), 'BOM'),
      lines: await tx.select().from(bomLines).where(and(eq(bomLines.tenantId, tenantId), eq(bomLines.bomId, id))).orderBy(asc(bomLines.lineNo)),
      operations: await tx.select().from(bomOperations).where(and(eq(bomOperations.tenantId, tenantId), eq(bomOperations.bomId, id))).orderBy(asc(bomOperations.opNo)),
    };
  }
  listBoms(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; itemId?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(boms).where(and(eq(boms.tenantId, tenantId), eq(boms.companyId, q.companyId), before ? lt(boms.id, before) : undefined, q.itemId ? eq(boms.itemId, q.itemId) : undefined, q.status ? eq(boms.status, q.status) : undefined)).orderBy(desc(boms.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }

  /** The active BOM in force for an item on a date, or null. */
  async activeBom(tx: Tx, tenantId: string, companyId: string, itemId: string, date: string): Promise<BomRow | null> {
    const [b] = await tx.select().from(boms).where(and(eq(boms.tenantId, tenantId), eq(boms.companyId, companyId), eq(boms.itemId, itemId), eq(boms.status, 'active'), lte(boms.effectiveFrom, date), or(isNull(boms.effectiveTo), gte(boms.effectiveTo, date))));
    return b ?? null;
  }

  /** Multi-level explosion: what it takes to make `quantity` of an item on a date, level by level and as raw requirements. */
  explode(tenantId: string, companyId: string, itemId: string, quantity: string, date: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const root = await this.activeBom(tx, tenantId, companyId, itemId, date);
      if (!root) throw new AppError(404, 'no_active_bom', 'No BOM is in force for this item on that date');
      const flat = new Map<string, bigint>();
      const walk = async (bom: BomRow, target: bigint, depth: number, path: string[]): Promise<ExplodedNode[]> => {
        if (depth > 20) throw new AppError(422, 'bom_too_deep', 'The BOM nests more than 20 levels');
        const lines = await tx.select().from(bomLines).where(and(eq(bomLines.tenantId, tenantId), eq(bomLines.bomId, bom.id))).orderBy(asc(bomLines.lineNo));
        const codes = new Map((await tx.select({ id: items.id, code: items.code }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, lines.map((l) => l.itemId))))).map((i) => [i.id, i.code]));
        const nodes: ExplodedNode[] = [];
        for (const l of lines) {
          const need = requirement(l.quantity, l.scrapPercent, target, qty.parse(bom.baseQuantity));
          const sub = path.includes(l.itemId) ? null : await this.activeBom(tx, tenantId, companyId, l.itemId, date);
          if (sub) nodes.push({ itemId: l.itemId, itemCode: codes.get(l.itemId) ?? '', quantity: qty.format(need), bomId: sub.id, children: await walk(sub, need, depth + 1, [...path, l.itemId]) });
          else { nodes.push({ itemId: l.itemId, itemCode: codes.get(l.itemId) ?? '', quantity: qty.format(need), bomId: null, children: [] }); flat.set(l.itemId, (flat.get(l.itemId) ?? 0n) + need); }
        }
        return nodes;
      };
      const tree = await walk(root, qty.parse(quantity), 1, [itemId]);
      const codes = new Map((await tx.select({ id: items.id, code: items.code }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, [...flat.keys()].concat('00000000-0000-0000-0000-000000000000'))))).map((i) => [i.id, i.code]));
      return { bomId: root.id, itemId, quantity, date, tree, rawRequirements: [...flat].map(([id, q]) => ({ itemId: id, itemCode: codes.get(id) ?? '', quantity: qty.format(q) })).sort((a, b) => a.itemCode.localeCompare(b.itemCode)) };
    }, { readOnly: true });
  }

  /** A component must not (directly or deeply) contain the item being defined. */
  private async assertNoCycle(tx: Tx, tenantId: string, companyId: string, parentId: string, componentIds: string[]): Promise<void> {
    const seen = new Set<string>();
    const stack = [...componentIds];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (id === parentId) throw new AppError(422, 'bom_cycle', 'This BOM would make the item a component of itself, through another BOM');
      if (seen.has(id)) continue;
      seen.add(id);
      const rows = await tx.select({ itemId: bomLines.itemId }).from(bomLines).innerJoin(boms, and(eq(boms.tenantId, bomLines.tenantId), eq(boms.id, bomLines.bomId))).where(and(eq(boms.tenantId, tenantId), eq(boms.companyId, companyId), eq(boms.itemId, id), eq(boms.status, 'active')));
      for (const r of rows) stack.push(r.itemId);
    }
  }
}
