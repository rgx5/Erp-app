import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import { cost, costOf, divRound, qty, value, valueOf } from '../inventory/decimal.js';
import { stockBalances } from '../inventory/inventory.schema.js';
import { first } from '../masterdata/helpers.js';
import { items } from '../masterdata/masterdata.schema.js';
import { bomLines, bomOperations, workCentres, workOrderMaterials, workOrderOperations, workOrderTransactions, workOrders } from './manufacturing.schema.js';
import { ManufacturingMastersService, requirement } from './masters.service.js';

const hoursUnits = (text: string): bigint => { const [i = '0', f = ''] = text.split('.'); return BigInt(i) * 10_000n + BigInt(f.padEnd(4, '0').slice(0, 4)); };
const hoursText = (u: bigint): string => `${u / 10_000n}.${(u % 10_000n).toString().padStart(4, '0')}`;
const costOfHours = (hours: bigint, rate: bigint): bigint => divRound(hours * rate, 10_000n);
const pct = (num: bigint, den: bigint): string | null => (den === 0n ? null : `${divRound(num * 1_000_000n, den) / 10_000n}.${(divRound(num * 1_000_000n, den) % 10_000n).toString().padStart(4, '0')}`);

export interface RollupNode { itemId: string; itemCode: string; quantity: string; unitCost: string; value: string; source: 'bom' | 'stock' | 'unknown'; children: RollupNode[] }

/**
 * Costing and variances. Cost is actual (ADR-26), so these are *analytical*: the roll-up says what an item should cost at today's
 * stock costs and work-centre rates; the variance report compares each work order's actual cost with what its own plan would have
 * cost at the prices and rates actually paid, split into usage (materials) and efficiency (time). Nothing here posts to the ledger.
 */
@Injectable()
export class CostingService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(ManufacturingMastersService) private readonly masters: ManufacturingMastersService,
  ) {}

  /** What it should cost to make `quantity` of an item on a date: materials at current stock cost, sub-assemblies by their own BOMs, labour and overhead at current rates. */
  rollup(tenantId: string, companyId: string, itemId: string, quantity: string, date: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const root = await this.masters.activeBom(tx, tenantId, companyId, itemId, date);
      if (!root) throw new AppError(404, 'no_active_bom', 'No BOM is in force for this item on that date');
      const totals = { material: 0n, labour: 0n, overhead: 0n };
      const unknown: string[] = [];
      const stockCost = new Map<string, bigint | null>();
      const unitCostOf = async (id: string): Promise<bigint | null> => {
        if (stockCost.has(id)) return stockCost.get(id) as bigint | null;
        const [agg] = await tx.select({ q: sql<string>`COALESCE(SUM(${stockBalances.quantity}) FILTER (WHERE ${stockBalances.quantity} > 0), 0)::text`, v: sql<string>`COALESCE(SUM(${stockBalances.value}) FILTER (WHERE ${stockBalances.quantity} > 0), 0)::text`, last: sql<string>`COALESCE(MAX(${stockBalances.lastCost}), 0)::text` }).from(stockBalances).where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.companyId, companyId), eq(stockBalances.itemId, id)));
        const q = qty.parse(agg?.q ?? '0');
        const c = q > 0n ? costOf(value.parse(agg?.v ?? '0'), q) : cost.parse(agg?.last ?? '0');
        const known = c > 0n ? c : null;
        stockCost.set(id, known);
        return known;
      };
      const walk = async (bomId: string, bomBase: bigint, target: bigint, depth: number, path: string[]): Promise<RollupNode[]> => {
        if (depth > 20) throw new AppError(422, 'bom_too_deep', 'The BOM nests more than 20 levels');
        const lines = await tx.select().from(bomLines).where(and(eq(bomLines.tenantId, tenantId), eq(bomLines.bomId, bomId))).orderBy(asc(bomLines.lineNo));
        const codes = new Map((await tx.select({ id: items.id, code: items.code }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, lines.map((l) => l.itemId).concat('00000000-0000-0000-0000-000000000000'))))).map((i) => [i.id, i.code]));
        const ops = await tx.select({ op: bomOperations, wc: workCentres }).from(bomOperations).innerJoin(workCentres, and(eq(workCentres.tenantId, bomOperations.tenantId), eq(workCentres.id, bomOperations.workCentreId))).where(and(eq(bomOperations.tenantId, tenantId), eq(bomOperations.bomId, bomId)));
        for (const { op, wc } of ops) {
          const h = hoursUnits(op.setupHours) + divRound(hoursUnits(op.runHours) * target, bomBase);
          totals.labour += costOfHours(h, hoursUnits(wc.labourRatePerHour));
          totals.overhead += costOfHours(h, hoursUnits(wc.machineRatePerHour) + hoursUnits(wc.overheadRatePerHour));
        }
        const nodes: RollupNode[] = [];
        for (const l of lines) {
          const need = requirement(l.quantity, l.scrapPercent, target, bomBase);
          const sub = path.includes(l.itemId) ? null : await this.masters.activeBom(tx, tenantId, companyId, l.itemId, date);
          if (sub) {
            const before = totals.material + totals.labour + totals.overhead;
            const children = await walk(sub.id, qty.parse(sub.baseQuantity), need, depth + 1, [...path, l.itemId]);
            const v = totals.material + totals.labour + totals.overhead - before;
            nodes.push({ itemId: l.itemId, itemCode: codes.get(l.itemId) ?? '', quantity: qty.format(need), unitCost: cost.format(costOf(v, need)), value: value.format(v), source: 'bom', children });
          } else {
            const c = await unitCostOf(l.itemId);
            if (c === null) unknown.push(codes.get(l.itemId) ?? l.itemId);
            const v = c === null ? 0n : valueOf(need, c);
            totals.material += v;
            nodes.push({ itemId: l.itemId, itemCode: codes.get(l.itemId) ?? '', quantity: qty.format(need), unitCost: cost.format(c ?? 0n), value: value.format(v), source: c === null ? 'unknown' : 'stock', children: [] });
          }
        }
        return nodes;
      };
      const q = qty.parse(quantity);
      const tree = await walk(root.id, qty.parse(root.baseQuantity), q, 1, [itemId]);
      const total = totals.material + totals.labour + totals.overhead;
      return {
        bomId: root.id, itemId, quantity, date, tree, material: value.format(totals.material), labour: value.format(totals.labour), overhead: value.format(totals.overhead), total: value.format(total), unitCost: cost.format(costOf(total, q)),
        complete: unknown.length === 0, itemsWithoutCost: [...new Set(unknown)],
      };
    }, { readOnly: true });
  }

  /** One work order: actual cost against the plan costed at the prices and rates actually paid. Positive variance means it cost more than planned. */
  workOrderVariance(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, (tx) => this.variance(tx, tenantId, id), { readOnly: true });
  }

  private async variance(tx: Tx, tenantId: string, id: string) {
    const wo = first(await tx.select().from(workOrders).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id))), 'Work order');
    const mats = await tx.select({ m: workOrderMaterials, code: items.code }).from(workOrderMaterials).innerJoin(items, and(eq(items.tenantId, workOrderMaterials.tenantId), eq(items.id, workOrderMaterials.itemId))).where(and(eq(workOrderMaterials.tenantId, tenantId), eq(workOrderMaterials.workOrderId, id))).orderBy(asc(workOrderMaterials.lineNo));
    const ops = await tx.select({ o: workOrderOperations, wc: workCentres }).from(workOrderOperations).innerJoin(workCentres, and(eq(workCentres.tenantId, workOrderOperations.tenantId), eq(workCentres.id, workOrderOperations.workCentreId))).where(and(eq(workOrderOperations.tenantId, tenantId), eq(workOrderOperations.workOrderId, id))).orderBy(asc(workOrderOperations.opNo));
    const txns = await tx.select().from(workOrderTransactions).where(and(eq(workOrderTransactions.tenantId, tenantId), eq(workOrderTransactions.workOrderId, id)));
    let plannedTotal = 0n;
    let actualTotal = 0n;
    const materials = [];
    for (const { m, code } of mats) {
      const mine = txns.filter((t) => t.itemId === m.itemId && (t.kind === 'material_issue' || t.kind === 'material_return'));
      const netValue = mine.reduce((a, t) => a + value.parseSigned(t.value), 0n);
      const netQty = qty.parse(m.issuedQuantity) - qty.parse(m.returnedQuantity);
      const required = qty.parse(m.requiredQuantity);
      let planned: bigint;
      if (netQty > 0n) planned = netQty === required ? netValue : divRound(netValue * required, netQty);
      else {
        const [b] = await tx.select({ c: sql<string>`COALESCE(MAX(${stockBalances.lastCost}), 0)::text` }).from(stockBalances).where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.itemId, m.itemId)));
        planned = valueOf(required, cost.parse(b?.c ?? '0'));
      }
      plannedTotal += planned;
      actualTotal += netValue;
      materials.push({ itemId: m.itemId, itemCode: code, requiredQuantity: m.requiredQuantity, netIssuedQuantity: qty.format(netQty), plannedValue: value.format(planned), actualValue: value.format(netValue), usageVariance: value.format(netValue - planned), usageVariancePercent: pct(netValue - planned, planned) });
    }
    const operations = [];
    for (const { o, wc } of ops) {
      const mine = txns.filter((t) => t.operationId === o.id);
      const actual = mine.reduce((a, t) => a + value.parseSigned(t.value), 0n);
      const actualHours = hoursUnits(o.actualHours);
      const planHours = hoursUnits(o.plannedHours);
      const rate = actualHours > 0n ? divRound(actual * 10_000n, actualHours) : hoursUnits(wc.labourRatePerHour) + hoursUnits(wc.machineRatePerHour) + hoursUnits(wc.overheadRatePerHour);
      const planned = costOfHours(planHours, rate);
      plannedTotal += planned;
      actualTotal += actual;
      operations.push({ opNo: o.opNo, name: o.name, plannedHours: o.plannedHours, actualHours: o.actualHours, hoursVariance: hoursText(actualHours > planHours ? actualHours - planHours : planHours - actualHours), hoursOver: actualHours > planHours, plannedValue: value.format(planned), actualValue: value.format(actual), efficiencyVariance: value.format(actual - planned), efficiencyVariancePercent: pct(actual - planned, planned) });
    }
    // Job-work charges are agreed in advance: they count the same in the plan and the actual (no variance of their own).
    const subcontract = txns.filter((t) => t.kind === 'subcontract').reduce((a, t) => a + value.parseSigned(t.value), 0n);
    plannedTotal += subcontract;
    actualTotal += subcontract;
    const produced = qty.parse(wo.producedQuantity);
    const planQty = qty.parse(wo.plannedQuantity);
    const finished = -txns.filter((t) => t.kind === 'output').reduce((a, t) => a + value.parseSigned(t.value), 0n);
    const residual = -txns.filter((t) => t.kind === 'residual').reduce((a, t) => a + value.parseSigned(t.value), 0n);
    return {
      workOrderId: id, woNo: wo.woNo, status: wo.status, itemId: wo.itemId, plannedQuantity: wo.plannedQuantity, producedQuantity: wo.producedQuantity, scrapQuantity: wo.scrapQuantity,
      materials, operations, subcontractCharges: value.format(subcontract),
      totals: { planned: value.format(plannedTotal), actual: value.format(actualTotal), variance: value.format(actualTotal - plannedTotal), variancePercent: pct(actualTotal - plannedTotal, plannedTotal), usage: value.format(materials.reduce((a, m) => a + value.parseSigned(m.usageVariance), 0n)), efficiency: value.format(operations.reduce((a, o) => a + value.parseSigned(o.efficiencyVariance), 0n)) },
      yield: { percent: pct(produced, planQty), shortfallQuantity: qty.format(planQty > produced ? planQty - produced : 0n), scrapRatePercent: pct(qty.parse(wo.scrapQuantity), produced + qty.parse(wo.scrapQuantity)) },
      unitCost: { actual: produced > 0n ? cost.format(costOf(finished, produced)) : null, planned: cost.format(costOf(plannedTotal, planQty)) },
      finishedGoodsValue: value.format(finished), residualClearedToVariance: value.format(residual),
    };
  }

  /** Completed work orders in a period with their variances, and the totals: where production cost more or less than planned. */
  variances(tenantId: string, companyId: string, from: string, to: string, itemId?: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const completed = await tx.execute<{ id: string }>(sql`
        SELECT w.id FROM erp.work_orders w WHERE w.tenant_id = ${tenantId}::uuid AND w.company_id = ${companyId}::uuid AND w.status = 'completed'
           ${itemId ? sql`AND w.item_id = ${itemId}::uuid` : sql``}
           AND (SELECT MAX(t.txn_date) FROM erp.work_order_transactions t WHERE t.tenant_id = w.tenant_id AND t.work_order_id = w.id) BETWEEN ${from}::date AND ${to}::date
         ORDER BY w.wo_no LIMIT 1000`);
      const list: Awaited<ReturnType<CostingService['workOrderVariance']>>[] = [];
      for (const r of completed.rows) list.push(await this.variance(tx, tenantId, r.id));
      const sum = (pick: (v: (typeof list)[number]) => string) => value.format(list.reduce((a, v) => a + value.parseSigned(pick(v)), 0n));
      return { companyId, from, to, workOrders: list.map((v) => ({ workOrderId: v.workOrderId, woNo: v.woNo, itemId: v.itemId, planned: v.totals.planned, actual: v.totals.actual, variance: v.totals.variance, usage: v.totals.usage, efficiency: v.totals.efficiency, yieldPercent: v.yield.percent })), totals: { planned: sum((v) => v.totals.planned), actual: sum((v) => v.totals.actual), variance: sum((v) => v.totals.variance), usage: sum((v) => v.totals.usage), efficiency: sum((v) => v.totals.efficiency) } };
    }, { readOnly: true, isolation: 'repeatable read' });
  }
}
