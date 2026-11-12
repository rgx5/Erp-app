import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { PeriodsService } from '../accounting/periods.service.js';
import { PostingService, type PostingLine } from '../accounting/posting.service.js';
import { accounts } from '../accounting/accounting.schema.js';
import { fromUnits as moneyFromUnits } from '../accounting/money.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { items } from '../masterdata/masterdata.schema.js';
import { businessLocations, warehouses } from '../organization/organization.schema.js';
import { cost, costOf, divRound, qty, value, valueOf } from './decimal.js';
import {
  batchBalances, batches, companyStockSettings, inventoryAccounts, stockBalances, stockCounters, stockLayerConsumptions, stockLayers, stockLedger, stockLedgerSerials, stockMovements, stockSerials,
} from './inventory.schema.js';

export type MovementType = 'opening' | 'receipt' | 'issue' | 'adjustment' | 'transfer_dispatch' | 'transfer_receipt' | 'transfer_direct' | 'count_adjustment';
export type MovementRow = typeof stockMovements.$inferSelect;
export type LedgerRow = typeof stockLedger.$inferSelect;

export interface MoveLine {
  warehouseId: string;
  itemId: string;
  direction: 'in' | 'out';
  /** Base-unit quantity, positive. */
  quantity: string;
  /** Required for incoming lines unless `carryCost` is given; issues are costed by the valuation method. */
  unitCost?: string | undefined;
  batchId?: string | undefined;
  batch?: { batchNo: string; manufactureDate?: string | undefined; expiryDate?: string | undefined } | undefined;
  serialNos?: string[] | undefined;
  /** For FIFO transfers: the cost layers consumed at the source, recreated at the destination with their own cost and date. */
  layers?: { quantity: string; unitCost: string; receivedOn: string }[] | undefined;
}

export interface MoveRequest {
  companyId: string;
  movementType: MovementType;
  postingDate: string;
  description: string;
  lines: MoveLine[];
  /** GL account for the other side of receipts and issues (documents pass their GRNI / COGS / WIP accounts). */
  offsetAccountId?: string | undefined;
  /** HTTP callers may only offset against ordinary accounts; subledger documents may use control accounts. */
  allowControlOffset?: boolean | undefined;
  source: { type: string; id?: string; event?: string };
  postedBy?: string | undefined;
}

/** What one processed line did, for callers (transfers need the cost and the consumed layers of the source side). */
export interface LineResult {
  ledger: LedgerRow;
  layers: { quantity: string; unitCost: string; receivedOn: string }[];
  serialNos: string[];
  batchId: string | null;
}

const PREFIX: Record<MovementType, string> = { opening: 'SO', receipt: 'SR', issue: 'SI', adjustment: 'SA', transfer_dispatch: 'TD', transfer_receipt: 'TR', transfer_direct: 'TX', count_adjustment: 'SC' };
const yy = (date: string): string => date.slice(2, 4);

/**
 * The inventory subledger. `move` is the ONLY way stock changes: it costs each line (weighted average or FIFO, per item), enforces
 * the negative-stock, batch and serial rules, appends immutable ledger rows, updates balances, and posts the matching general-ledger
 * entry through the PostingService, all in the caller's transaction. Purchasing, sales, production, transfers and counts all call it.
 */
@Injectable()
export class StockService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PeriodsService) private readonly periods: PeriodsService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  async move(tx: Tx, tenantId: string, request: MoveRequest): Promise<{ movement: MovementRow; results: LineResult[]; replayed: boolean }> {
    if (request.source.type !== 'manual') {
      const [existing] = await tx
        .select()
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.sourceType, request.source.type), eq(stockMovements.sourceId, request.source.id ?? ''), eq(stockMovements.sourceEvent, request.source.event ?? 'post')));
      if (existing) return { movement: existing, results: [], replayed: true };
    }
    if (request.lines.length === 0) throw validationFailed([{ path: 'lines', message: 'A movement needs at least one line' }]);

    // Period first: stock dates lock with the books (and the period row is held FOR SHARE until commit).
    const { fiscalYear } = await this.periods.openPeriodFor(tx, tenantId, request.companyId, request.postingDate);

    const itemIds = [...new Set(request.lines.map((l) => l.itemId))];
    const warehouseIds = [...new Set(request.lines.map((l) => l.warehouseId))];
    const itemRows = new Map((await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)))).map((i) => [i.id, i]));
    const warehouseRows = new Map(
      (
        await tx
          .select({ w: warehouses, companyId: businessLocations.companyId })
          .from(warehouses)
          .innerJoin(businessLocations, and(eq(businessLocations.tenantId, warehouses.tenantId), eq(businessLocations.id, warehouses.businessLocationId)))
          .where(and(eq(warehouses.tenantId, tenantId), inArray(warehouses.id, warehouseIds)))
      ).map((r) => [r.w.id, { ...r.w, companyId: r.companyId }]),
    );
    const transfer = request.movementType.startsWith('transfer');
    request.lines.forEach((line, i) => {
      const item = itemRows.get(line.itemId);
      const warehouse = warehouseRows.get(line.warehouseId);
      const at = (field: string) => `lines.${i}.${field}`;
      if (!item) throw validationFailed([{ path: at('itemId'), message: 'This item does not exist' }]);
      if (!item.isStocked || item.costingMethod === null) throw new AppError(422, 'item_not_stocked', `${item.code} is not a stocked item`);
      if (item.status !== 'active') throw new AppError(422, 'item_inactive', `${item.code} is inactive`);
      if (!warehouse || warehouse.companyId !== request.companyId) throw validationFailed([{ path: at('warehouseId'), message: 'This warehouse does not exist in this company' }]);
      if (warehouse.status !== 'active') throw new AppError(422, 'warehouse_inactive', `Warehouse ${warehouse.code} is inactive`);
      if (!transfer && warehouse.kind === 'in_transit') throw new AppError(422, 'warehouse_in_transit', 'Stock is moved in and out of an in-transit warehouse only by transfers');
      const q = qty.parse(line.quantity);
      if (q <= 0n) throw validationFailed([{ path: at('quantity'), message: 'The quantity must be greater than zero' }]);
      if (item.tracking === 'batch' && !line.batchId && !line.batch) throw new AppError(422, 'batch_required', `${item.code} is batch tracked: give a batch`);
      if (item.tracking !== 'batch' && (line.batchId || line.batch)) throw new AppError(422, 'item_not_batch_tracked', `${item.code} is not batch tracked`);
      if (item.tracking === 'serial') {
        if (q % 10n ** 6n !== 0n) throw new AppError(422, 'serial_quantity', `${item.code} is serial tracked: the quantity must be a whole number`);
        if (!line.serialNos || BigInt(line.serialNos.length) * 10n ** 6n !== q || new Set(line.serialNos).size !== line.serialNos.length) {
          throw new AppError(422, 'serial_required', `${item.code} is serial tracked: give exactly one distinct serial number per unit`);
        }
      } else if (line.serialNos) throw new AppError(422, 'item_not_serial_tracked', `${item.code} is not serial tracked`);
    });

    // Number and header. The header is inserted first (ledger rows reference it); its journal link is filled in at the end.
    const [counter] = await tx
      .insert(stockCounters)
      .values({ tenantId, companyId: request.companyId, fiscalYearId: fiscalYear.id, prefix: PREFIX[request.movementType], nextValue: 2 })
      .onConflictDoUpdate({ target: [stockCounters.tenantId, stockCounters.companyId, stockCounters.fiscalYearId, stockCounters.prefix], set: { nextValue: sql`${stockCounters.nextValue} + 1` } })
      .returning({ next: stockCounters.nextValue });
    const movementNo = `${PREFIX[request.movementType]}/${yy(fiscalYear.startDate)}${yy(fiscalYear.endDate)}/${String((counter?.next ?? 2) - 1).padStart(6, '0')}`;
    const movement = first(
      await tx
        .insert(stockMovements)
        .values({
          tenantId, id: uuidv7(), companyId: request.companyId, movementNo, movementType: request.movementType, postingDate: request.postingDate, description: request.description,
          sourceType: request.source.type, sourceId: request.source.id ?? null, sourceEvent: request.source.event ?? 'post', postedBy: request.postedBy ?? null,
        })
        .returning(),
      'Stock movement',
    );

    // Process lines in a fixed (warehouse, item) order so concurrent movements lock rows in the same order: no deadlocks.
    const order = request.lines.map((line, index) => ({ line, index })).sort((a, b) => (a.line.warehouseId + a.line.itemId).localeCompare(b.line.warehouseId + b.line.itemId) || a.index - b.index);
    const results: LineResult[] = Array.from({ length: request.lines.length });
    for (const { line, index } of order) {
      results[index] = await this.processLine(tx, tenantId, request, movement, index + 1, line, itemRows.get(line.itemId) as typeof items.$inferSelect, warehouseRows.get(line.warehouseId) as { allowNegativeStock: boolean });
    }

    const journalEntryId = await this.postToLedger(tx, tenantId, request, movement, results, itemRows);
    await this.recorder.record(tx, tenantId, 'stock_movement', 'posted', movement, { movementNo, movementType: request.movementType, postingDate: request.postingDate, lines: results.length, ...(journalEntryId ? { journalEntryId } : {}) });
    return { movement: journalEntryId ? { ...movement, journalEntryId } : movement, results, replayed: false };
  }

  // ---- one line -------------------------------------------------------------------------------------------------
  private async processLine(
    tx: Tx, tenantId: string, request: MoveRequest, movement: MovementRow, lineNo: number, line: MoveLine, item: typeof items.$inferSelect, warehouse: { allowNegativeStock: boolean },
  ): Promise<LineResult> {
    const q = qty.parse(line.quantity);
    const fifo = item.costingMethod === 'fifo';
    const incoming = line.direction === 'in';

    // Lock this item's balance in this warehouse for the rest of the transaction.
    await tx.insert(stockBalances).values({ tenantId, companyId: request.companyId, warehouseId: line.warehouseId, itemId: line.itemId }).onConflictDoNothing();
    const [balance] = await tx
      .select()
      .from(stockBalances)
      .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, line.warehouseId), eq(stockBalances.itemId, line.itemId)))
      .for('update');
    if (!balance) throw new Error('stock balance row missing');
    const balQty = qty.parseSigned(balance.quantity);
    const balVal = value.parseSigned(balance.value);
    const lastCost = cost.parse(balance.lastCost);

    const batch = item.tracking === 'batch' ? await this.resolveBatch(tx, tenantId, item, line, request.postingDate, incoming) : null;

    let unitCost: bigint;
    let lineValue: bigint;
    const consumed: { layerId: string; quantity: bigint; unitCost: bigint; value: bigint; receivedOn: string }[] = [];
    let newLayers: { quantity: bigint; unitCost: bigint; receivedOn: string }[] = [];

    if (incoming) {
      if (line.layers && line.layers.length > 0) {
        // FIFO transfer in: keep the source layers' costs and dates.
        newLayers = line.layers.map((l) => ({ quantity: qty.parse(l.quantity), unitCost: cost.parse(l.unitCost), receivedOn: l.receivedOn }));
        lineValue = newLayers.reduce((sum, l) => sum + valueOf(l.quantity, l.unitCost), 0n);
        if (newLayers.reduce((sum, l) => sum + l.quantity, 0n) !== q) throw new AppError(500, 'layer_mismatch', 'The cost layers do not add up to the quantity');
        unitCost = costOf(lineValue, q);
      } else {
        if (line.unitCost !== undefined) unitCost = cost.parse(line.unitCost);
        else if (request.movementType === 'adjustment' || request.movementType === 'count_adjustment') {
          // A found-stock adjustment nobody priced is valued like the stock already held: the average, or the newest FIFO layer.
          let derived = balQty > 0n && !fifo ? costOf(balVal, balQty) : lastCost;
          if (fifo) {
            const [newest] = await tx.select({ unitCost: stockLayers.unitCost }).from(stockLayers).where(and(eq(stockLayers.tenantId, tenantId), eq(stockLayers.warehouseId, line.warehouseId), eq(stockLayers.itemId, line.itemId))).orderBy(sql`${stockLayers.receivedOn} DESC, ${stockLayers.id} DESC`).limit(1);
            if (newest) derived = cost.parse(newest.unitCost);
          }
          if (derived === 0n) throw new AppError(422, 'unit_cost_required', `${item.code} has no cost history: give a unit cost`);
          unitCost = derived;
        } else throw new AppError(422, 'unit_cost_required', `A unit cost is needed to receive ${item.code}`);
        lineValue = valueOf(q, unitCost);
        newLayers = [{ quantity: q, unitCost, receivedOn: request.postingDate }];
      }
    } else {
      const available = balQty;
      if (available < q) {
        const mayGoNegative = warehouse.allowNegativeStock && !fifo;
        if (!mayGoNegative) throw new AppError(409, 'insufficient_stock', `Not enough ${item.code}: ${qty.format(available > 0n ? available : 0n)} available, ${line.quantity} requested`, { available: qty.format(available > 0n ? available : 0n), requested: line.quantity });
      }
      if (fifo) {
        const layers = await tx
          .select()
          .from(stockLayers)
          .where(and(eq(stockLayers.tenantId, tenantId), eq(stockLayers.warehouseId, line.warehouseId), eq(stockLayers.itemId, line.itemId), sql`${stockLayers.remaining} > 0`))
          .orderBy(asc(stockLayers.receivedOn), asc(stockLayers.id))
          .for('update');
        let need = q;
        for (const layer of layers) {
          if (need === 0n) break;
          const take = qty.parse(layer.remaining) < need ? qty.parse(layer.remaining) : need;
          const layerCost = cost.parse(layer.unitCost);
          consumed.push({ layerId: layer.id, quantity: take, unitCost: layerCost, value: valueOf(take, layerCost), receivedOn: layer.receivedOn });
          need -= take;
        }
        if (need > 0n) throw new AppError(409, 'insufficient_stock', `Not enough ${item.code} in cost layers`);
        lineValue = consumed.reduce((sum, c) => sum + c.value, 0n);
        // Taking the last unit empties the balance exactly: no rounding residue is left behind.
        if (balQty === q && lineValue !== balVal) {
          const last = consumed[consumed.length - 1];
          if (last) last.value += balVal - lineValue;
          lineValue = balVal;
        }
      } else {
        const fromStock = balQty > 0n ? (balQty < q ? balQty : q) : 0n;
        const stockValue = fromStock === 0n ? 0n : fromStock === balQty ? balVal : divRound(balVal * fromStock, balQty);
        // Anything beyond what is on hand (allowed negative stock) is costed at the last known cost.
        lineValue = stockValue + valueOf(q - fromStock, lastCost);
      }
      unitCost = costOf(lineValue, q);
    }

    const signedQty = incoming ? q : -q;
    const signedValue = incoming ? lineValue : -lineValue;
    const newQty = balQty + signedQty;
    const newVal = balVal + signedValue;

    const [ledgerRow] = await tx
      .insert(stockLedger)
      .values({
        tenantId, id: uuidv7(), movementId: movement.id, companyId: request.companyId, lineNo, warehouseId: line.warehouseId, itemId: line.itemId, batchId: batch?.id ?? null, postingDate: request.postingDate,
        quantity: qty.format(signedQty), unitCost: cost.format(unitCost), value: value.format(signedValue), balanceQuantity: qty.format(newQty), balanceValue: value.format(newVal),
      })
      .returning();
    if (!ledgerRow) throw new Error('ledger insert returned no row');

    await tx
      .update(stockBalances)
      .set({ quantity: qty.format(newQty), value: value.format(newVal), ...(incoming ? { lastCost: cost.format(unitCost) } : {}), updatedAt: new Date() })
      .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, line.warehouseId), eq(stockBalances.itemId, line.itemId)));

    // FIFO layers
    if (fifo && incoming) {
      for (const l of newLayers) {
        await tx.insert(stockLayers).values({ tenantId, id: uuidv7(), companyId: request.companyId, warehouseId: line.warehouseId, itemId: line.itemId, ledgerId: ledgerRow.id, receivedOn: l.receivedOn, quantity: qty.format(l.quantity), remaining: qty.format(l.quantity), unitCost: cost.format(l.unitCost) });
      }
    }
    if (fifo && !incoming) {
      for (const c of consumed) {
        const [layer] = await tx.select({ remaining: stockLayers.remaining }).from(stockLayers).where(and(eq(stockLayers.tenantId, tenantId), eq(stockLayers.id, c.layerId)));
        await tx.update(stockLayers).set({ remaining: qty.format(qty.parse(layer?.remaining ?? '0') - c.quantity) }).where(and(eq(stockLayers.tenantId, tenantId), eq(stockLayers.id, c.layerId)));
        await tx.insert(stockLayerConsumptions).values({ tenantId, id: uuidv7(), issueLedgerId: ledgerRow.id, layerId: c.layerId, quantity: qty.format(c.quantity), unitCost: cost.format(c.unitCost), value: value.format(c.value) });
      }
    }

    // Batch balance (never negative, even where the warehouse allows negative stock).
    if (batch) {
      await tx.insert(batchBalances).values({ tenantId, warehouseId: line.warehouseId, itemId: line.itemId, batchId: batch.id }).onConflictDoNothing();
      const [bb] = await tx
        .select()
        .from(batchBalances)
        .where(and(eq(batchBalances.tenantId, tenantId), eq(batchBalances.warehouseId, line.warehouseId), eq(batchBalances.itemId, line.itemId), eq(batchBalances.batchId, batch.id)))
        .for('update');
      const next = qty.parse(bb?.quantity ?? '0') + signedQty;
      if (next < 0n) throw new AppError(409, 'insufficient_batch_stock', `Not enough of batch ${batch.batchNo} of ${item.code}: ${bb?.quantity ?? '0'} available, ${line.quantity} requested`);
      await tx.update(batchBalances).set({ quantity: qty.format(next), updatedAt: new Date() }).where(and(eq(batchBalances.tenantId, tenantId), eq(batchBalances.warehouseId, line.warehouseId), eq(batchBalances.itemId, line.itemId), eq(batchBalances.batchId, batch.id)));
    }

    // Serial numbers
    const serialNos = line.serialNos ?? [];
    if (item.tracking === 'serial') {
      if (incoming) {
        const clash = await tx.select({ serialNo: stockSerials.serialNo }).from(stockSerials).where(and(eq(stockSerials.tenantId, tenantId), eq(stockSerials.itemId, line.itemId), inArray(stockSerials.serialNo, serialNos)));
        if (clash.length > 0) throw new AppError(409, 'serial_exists', `Serial number ${clash[0]?.serialNo} of ${item.code} already exists`, { serialNos: clash.map((c) => c.serialNo) });
        const created = await tx.insert(stockSerials).values(serialNos.map((serialNo) => ({ tenantId, id: uuidv7(), itemId: line.itemId, serialNo, warehouseId: line.warehouseId, receiptLedgerId: ledgerRow.id }))).returning({ id: stockSerials.id });
        await tx.insert(stockLedgerSerials).values(created.map((s) => ({ tenantId, ledgerId: ledgerRow.id, serialId: s.id })));
      } else {
        const found = await tx
          .select({ id: stockSerials.id, serialNo: stockSerials.serialNo })
          .from(stockSerials)
          .where(and(eq(stockSerials.tenantId, tenantId), eq(stockSerials.itemId, line.itemId), eq(stockSerials.warehouseId, line.warehouseId), eq(stockSerials.status, 'in_stock'), inArray(stockSerials.serialNo, serialNos)))
          .for('update');
        if (found.length !== serialNos.length) {
          const have = new Set(found.map((f) => f.serialNo));
          throw new AppError(409, 'serial_not_available', `Serial numbers not in stock in this warehouse: ${serialNos.filter((s) => !have.has(s)).join(', ')}`, { serialNos: serialNos.filter((s) => !have.has(s)) });
        }
        await tx.update(stockSerials).set({ status: 'issued', issueLedgerId: ledgerRow.id }).where(and(eq(stockSerials.tenantId, tenantId), inArray(stockSerials.id, found.map((f) => f.id))));
        await tx.insert(stockLedgerSerials).values(found.map((s) => ({ tenantId, ledgerId: ledgerRow.id, serialId: s.id })));
      }
    }

    return {
      ledger: ledgerRow,
      layers: incoming ? newLayers.map((l) => ({ quantity: qty.format(l.quantity), unitCost: cost.format(l.unitCost), receivedOn: l.receivedOn })) : consumed.map((c) => ({ quantity: qty.format(c.quantity), unitCost: cost.format(c.unitCost), receivedOn: c.receivedOn })),
      serialNos,
      batchId: batch?.id ?? null,
    };
  }

  private async resolveBatch(tx: Tx, tenantId: string, item: typeof items.$inferSelect, line: MoveLine, postingDate: string, incoming: boolean) {
    let batch: typeof batches.$inferSelect | undefined;
    if (line.batchId) {
      [batch] = await tx.select().from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.itemId, item.id), eq(batches.id, line.batchId)));
      if (!batch) throw validationFailed([{ path: 'batchId', message: `This batch does not belong to ${item.code}` }]);
    } else if (line.batch) {
      if (!incoming) throw new AppError(422, 'batch_required', 'Only incoming lines can create a batch');
      [batch] = await tx.select().from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.itemId, item.id), eq(batches.batchNo, line.batch.batchNo)));
      if (batch && ((line.batch.expiryDate && line.batch.expiryDate !== batch.expiryDate) || (line.batch.manufactureDate && line.batch.manufactureDate !== batch.manufactureDate))) {
        throw new AppError(422, 'batch_mismatch', `Batch ${batch.batchNo} already exists with different dates`);
      }
      if (!batch) [batch] = await tx.insert(batches).values({ tenantId, id: uuidv7(), itemId: item.id, batchNo: line.batch.batchNo, manufactureDate: line.batch.manufactureDate ?? null, expiryDate: line.batch.expiryDate ?? null }).returning();
    }
    if (!batch) throw new AppError(422, 'batch_required', `${item.code} is batch tracked: give a batch`);
    if (batch.status !== 'active') throw new AppError(422, 'batch_blocked', `Batch ${batch.batchNo} is blocked`);
    if (batch.expiryDate && batch.expiryDate < postingDate) throw new AppError(422, 'batch_expired', `Batch ${batch.batchNo} expired on ${batch.expiryDate}`);
    return batch;
  }

  // ---- general ledger ---------------------------------------------------------------------------------------------
  /** Posts the movement's value to the GL (inventory accounts vs the offset) and links the entry to the movement. */
  private async postToLedger(tx: Tx, tenantId: string, request: MoveRequest, movement: MovementRow, results: LineResult[], itemRows: Map<string, typeof items.$inferSelect>): Promise<string | null> {
    const mapping = new Map((await tx.select().from(inventoryAccounts).where(and(eq(inventoryAccounts.tenantId, tenantId), eq(inventoryAccounts.companyId, request.companyId)))).map((m) => [m.itemType, m.accountId]));
    const nets = new Map<string, bigint>();
    let total = 0n;
    for (const { ledger } of results) {
      const v = value.parseSigned(ledger.value);
      if (v === 0n) continue;
      const type = itemRows.get(ledger.itemId)?.itemType ?? '';
      const accountId = mapping.get(type);
      if (!accountId) throw new AppError(409, 'stock_accounts_not_configured', `No inventory account is configured for ${type.replaceAll('_', ' ')} stock; map one first`, { itemType: type });
      nets.set(accountId, (nets.get(accountId) ?? 0n) + v);
      total += v;
    }
    const lines: PostingLine[] = [];
    for (const [accountId, net] of nets) if (net !== 0n) lines.push(net > 0n ? { accountId, debit: moneyFromUnits(net) } : { accountId, credit: moneyFromUnits(-net) });
    if (total !== 0n) {
      const offsetAccountId = await this.offsetAccount(tx, tenantId, request);
      lines.push(total > 0n ? { accountId: offsetAccountId, credit: moneyFromUnits(total) } : { accountId: offsetAccountId, debit: moneyFromUnits(-total) });
    } else if (request.offsetAccountId) {
      await this.assertOffset(tx, tenantId, request.companyId, request.offsetAccountId, request.allowControlOffset === true);
    }
    if (lines.length === 0) return null;
    const { entry } = await this.posting.post(tx, tenantId, {
      companyId: request.companyId, postingDate: request.postingDate, journalType: 'system', description: `Stock ${request.movementType.replaceAll('_', ' ')} ${movement.movementNo}: ${request.description}`,
      lines, source: { type: 'stock_movement', id: movement.id }, postedBy: request.postedBy,
    });
    await tx.update(stockMovements).set({ journalEntryId: entry.id }).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.id, movement.id)));
    return entry.id;
  }

  private async offsetAccount(tx: Tx, tenantId: string, request: MoveRequest): Promise<string> {
    if (request.movementType === 'receipt' || request.movementType === 'issue') {
      if (!request.offsetAccountId) throw new AppError(422, 'offset_account_required', 'A receipt or issue needs the account to post against');
      await this.assertOffset(tx, tenantId, request.companyId, request.offsetAccountId, request.allowControlOffset === true);
      return request.offsetAccountId;
    }
    const [settings] = await tx.select().from(companyStockSettings).where(and(eq(companyStockSettings.tenantId, tenantId), eq(companyStockSettings.companyId, request.companyId)));
    const wanted = request.movementType === 'opening' ? settings?.openingBalanceAccountId : request.movementType === 'adjustment' || request.movementType === 'count_adjustment' ? settings?.adjustmentAccountId : undefined;
    if (!wanted) throw new AppError(409, 'stock_accounts_not_configured', `Set the ${request.movementType === 'opening' ? 'opening balance' : 'stock adjustment'} account in the company stock settings first`);
    return wanted;
  }

  private async assertOffset(tx: Tx, tenantId: string, companyId: string, accountId: string, allowControl: boolean): Promise<void> {
    const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, accountId)));
    if (!a) throw validationFailed([{ path: 'offsetAccountId', message: 'This account does not exist in this company' }]);
    if (a.isGroup || a.status !== 'active') throw new AppError(422, 'account_not_postable', `${a.code} ${a.name} cannot be posted to`);
    if (a.controlKind && !allowControl) throw new AppError(422, 'control_account', `${a.code} ${a.name} is a control account; use the document that owns it`);
  }

  /** Wraps `move` in the caller's tenant transaction (HTTP and tests). */
  moveInTenant(tenantId: string, request: MoveRequest) {
    return this.uow.inTenant(tenantId, (tx) => this.move(tx, tenantId, request));
  }
}
