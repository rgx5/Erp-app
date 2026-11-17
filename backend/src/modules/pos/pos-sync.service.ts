import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { posDevices, posPaymentAccounts, posSettings, posShifts, posSyncItems, posTerminals } from './pos.schema.js';
import { syncReturnPayload, syncSalePayload, type SyncBatchInput } from './pos.schemas.js';
import { PosService } from './pos.service.js';

export type DeviceRow = typeof posDevices.$inferSelect;
export interface ItemResult { clientId: string; status: 'applied' | 'duplicate' | 'rejected'; saleId?: string | undefined; documentNo?: string | undefined; error?: { code: string; message: string } | undefined }

/** Stable JSON: keys sorted, so the same content always hashes the same however the till ordered its fields. */
const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
const hashOf = (kind: string, occurredAt: string, payload: unknown): string => createHash('sha256').update(canonical({ kind, occurredAt, payload })).digest('hex');
const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Offline tills. A till works without a connection, queueing sales and returns under client-generated ids, then uploads them in a
 * batch. Each item is applied in its own transaction, in the order it happened, exactly once: the outcome (applied, or rejected with
 * the reason) is stored under (device, client id), so a retried upload returns the stored outcome and never books a sale twice. The
 * till is authoritative for what it sold and at what price; the server refuses only what the books cannot take (stock, a closed
 * period, a closed shift), and a rejected item can be retried unchanged once the cause is fixed.
 */
@Injectable()
export class PosSyncService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PosService) private readonly pos: PosService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- devices ---------------------------------------------------------------------------------------------------------------
  registerDevice(tenantId: string, actorId: string, input: { terminalId: string; name: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const terminal = first(await tx.select().from(posTerminals).where(and(eq(posTerminals.tenantId, tenantId), eq(posTerminals.id, input.terminalId))), 'Terminal');
      if (terminal.status !== 'active') throw new AppError(409, 'terminal_inactive', 'This terminal is not active');
      const row = first(await tx.insert(posDevices).values({ tenantId, id: uuidv7(), companyId: terminal.companyId, terminalId: terminal.id, name: input.name, registeredBy: actorId }).returning(), 'Device');
      await this.recorder.record(tx, tenantId, 'pos_device', 'registered', row, { terminal: terminal.code, name: input.name });
      return row;
    });
  }
  revokeDevice(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const d = first(await tx.select().from(posDevices).where(and(eq(posDevices.tenantId, tenantId), eq(posDevices.id, id))).for('update'), 'Device');
      if (d.status === 'revoked') throw new AppError(409, 'already_revoked', 'This device is already revoked');
      const row = first(await tx.update(posDevices).set({ status: 'revoked' }).where(and(eq(posDevices.tenantId, tenantId), eq(posDevices.id, id))).returning(), 'Device');
      await this.recorder.record(tx, tenantId, 'pos_device', 'revoked', row, { name: row.name });
      return row;
    });
  }
  listDevices(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(posDevices).where(and(eq(posDevices.tenantId, tenantId), eq(posDevices.companyId, companyId))).orderBy(asc(posDevices.createdAt));
      const counts = await tx.execute<{ device_id: string; applied: string; rejected: string }>(sql`SELECT device_id, COUNT(*) FILTER (WHERE status = 'applied')::text AS applied, COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected FROM erp.pos_sync_items WHERE tenant_id = ${tenantId}::uuid GROUP BY device_id`);
      return rows.map((d) => ({ ...d, applied: Number(counts.rows.find((c) => c.device_id === d.id)?.applied ?? 0), rejected: Number(counts.rows.find((c) => c.device_id === d.id)?.rejected ?? 0) }));
    }, { readOnly: true });
  }

  // ---- upload ----------------------------------------------------------------------------------------------------------------
  async upload(tenantId: string, actorId: string, input: SyncBatchInput) {
    const { device, shift } = await this.uow.inTenant(tenantId, async (tx) => {
      const d = first(await tx.select().from(posDevices).where(and(eq(posDevices.tenantId, tenantId), eq(posDevices.id, input.deviceId))), 'Device');
      if (d.status !== 'active') throw new AppError(403, 'device_revoked', 'This device was revoked and cannot upload');
      const s = first(await tx.select().from(posShifts).where(and(eq(posShifts.tenantId, tenantId), eq(posShifts.id, input.shiftId))), 'Shift');
      if (s.terminalId !== d.terminalId) throw validationFailed([{ path: 'shiftId', message: 'This shift belongs to a different terminal than the device' }]);
      return { device: d, shift: s };
    }, { readOnly: true });
    // In the order it happened (the client's own order breaks ties), so a return always follows the sale it returns.
    const ordered = input.items.map((item, index) => ({ item, index })).sort((a, b) => (a.item.occurredAt < b.item.occurredAt ? -1 : a.item.occurredAt > b.item.occurredAt ? 1 : a.index - b.index));
    const results: ItemResult[] = [];
    for (const { item } of ordered) results.push(await this.applyItem(tenantId, actorId, device, shift, item));
    await this.uow.inTenant(tenantId, async (tx) => { await tx.update(posDevices).set({ lastSyncAt: new Date() }).where(and(eq(posDevices.tenantId, tenantId), eq(posDevices.id, device.id))); });
    const by = (s: ItemResult['status']) => results.filter((r) => r.status === s).length;
    return { deviceId: device.id, received: results.length, applied: by('applied'), duplicates: by('duplicate'), rejected: by('rejected'), results };
  }

  private async applyItem(tenantId: string, actorId: string, device: DeviceRow, shift: typeof posShifts.$inferSelect, item: SyncBatchInput['items'][number]): Promise<ItemResult> {
    const hash = hashOf(item.kind, item.occurredAt, item.payload);
    let attempts = 1;
    try {
      return await this.uow.inTenant(tenantId, async (tx): Promise<ItemResult> => {
        // One upload at a time per (device, client id): a retry racing the original waits for it and then sees its outcome.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pos-sync:${tenantId}:${device.id}:${item.clientId}`}, 0))`);
        const [prior] = await tx.select().from(posSyncItems).where(and(eq(posSyncItems.tenantId, tenantId), eq(posSyncItems.deviceId, device.id), eq(posSyncItems.clientId, item.clientId)));
        if (prior) attempts = prior.attempts + 1;
        if (prior && prior.payloadHash !== hash) return { clientId: item.clientId, status: 'rejected', error: { code: 'client_id_reused', message: 'This client id was already used for different content' } };
        if (prior?.status === 'applied') return { clientId: item.clientId, status: 'duplicate', saleId: prior.posSaleId ?? undefined };
        const date = item.occurredAt.slice(0, 10);
        if (date > today()) throw new AppError(422, 'date_in_future', 'The till says this happened in the future: check its clock');
        const [liveShift] = await tx.select().from(posShifts).where(and(eq(posShifts.tenantId, tenantId), eq(posShifts.id, shift.id)));
        if (!liveShift || liveShift.status !== 'open') throw new AppError(409, 'shift_closed', 'The shift is closed: open one and upload again');
        let id: string;
        if (item.kind === 'sale') {
          const p = syncSalePayload.safeParse(item.payload);
          if (!p.success) throw validationFailed(p.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
          id = (await this.pos.sale(tenantId, actorId, { ...p.data, shiftId: shift.id, date })).sale.id;
        } else {
          const p = syncReturnPayload.safeParse(item.payload);
          if (!p.success) throw validationFailed(p.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
          const originalSaleId = p.data.originalSaleId ?? (await this.appliedSale(tx, tenantId, device.id, p.data.originalClientId as string));
          const original = await this.pos.getSale(tenantId, originalSaleId);
          const lines = p.data.lines.map((l, i) => {
            const line = original.lines.find((x) => x.lineNo === l.lineNo);
            if (!line) throw validationFailed([{ path: `lines.${i}.lineNo`, message: `The original sale has no line ${l.lineNo}` }]);
            return { originalLineId: line.id, quantity: l.quantity, unitPrice: l.unitPrice, serialNos: l.serialNos, warehouseId: l.warehouseId };
          });
          id = (await this.pos.return(tenantId, actorId, { shiftId: shift.id, date, originalSaleId, reason: p.data.reason, lines, refunds: p.data.refunds })).sale.id;
        }
        await this.record(tx, tenantId, device.id, item, hash, attempts, { status: 'applied', saleId: id });
        return { clientId: item.clientId, status: 'applied', saleId: id };
      });
    } catch (error) {
      if (!(error instanceof AppError)) throw error; // an unexpected failure: the whole upload can be retried safely
      const err = { code: error.code, message: error.message };
      await this.uow.inTenant(tenantId, async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pos-sync:${tenantId}:${device.id}:${item.clientId}`}, 0))`);
        const [again] = await tx.select().from(posSyncItems).where(and(eq(posSyncItems.tenantId, tenantId), eq(posSyncItems.deviceId, device.id), eq(posSyncItems.clientId, item.clientId)));
        if (again?.status === 'applied') return; // a concurrent upload of the same item succeeded meanwhile: its outcome stands
        await this.record(tx, tenantId, device.id, item, hash, again ? again.attempts + 1 : attempts, { status: 'rejected', error: err });
      });
      return { clientId: item.clientId, status: 'rejected', error: err };
    }
  }

  private async appliedSale(tx: Tx, tenantId: string, deviceId: string, clientId: string): Promise<string> {
    const [row] = await tx.select().from(posSyncItems).where(and(eq(posSyncItems.tenantId, tenantId), eq(posSyncItems.deviceId, deviceId), eq(posSyncItems.clientId, clientId)));
    if (!row) throw new AppError(409, 'original_unknown', 'The sale being returned has not been uploaded yet');
    if (row.status !== 'applied' || !row.posSaleId) throw new AppError(409, 'original_rejected', 'The sale being returned was rejected: fix it first');
    return row.posSaleId;
  }

  private async record(tx: Tx, tenantId: string, deviceId: string, item: SyncBatchInput['items'][number], hash: string, attempts: number, outcome: { status: 'applied'; saleId: string } | { status: 'rejected'; error: { code: string; message: string } }) {
    const values = outcome.status === 'applied' ? { status: 'applied', posSaleId: outcome.saleId, errorCode: null, errorMessage: null } : { status: 'rejected', posSaleId: null, errorCode: outcome.error.code, errorMessage: outcome.error.message };
    await tx.insert(posSyncItems).values({ tenantId, deviceId, clientId: item.clientId, kind: item.kind, payloadHash: hash, occurredAt: item.occurredAt, attempts, ...values }).onConflictDoUpdate({ target: [posSyncItems.tenantId, posSyncItems.deviceId, posSyncItems.clientId], set: { ...values, attempts, processedAt: new Date() } });
  }

  // ---- reads ------------------------------------------------------------------------------------------------------------------
  listItems(tenantId: string, q: { deviceId: string; limit: number; cursor?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      first(await tx.select().from(posDevices).where(and(eq(posDevices.tenantId, tenantId), eq(posDevices.id, q.deviceId))), 'Device');
      const rows = await tx.select().from(posSyncItems).where(and(eq(posSyncItems.tenantId, tenantId), eq(posSyncItems.deviceId, q.deviceId), before ? lt(posSyncItems.clientId, before) : undefined, q.status ? eq(posSyncItems.status, q.status) : undefined)).orderBy(desc(posSyncItems.clientId)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.clientId) : null };
    }, { readOnly: true });
  }

  /** What a till needs to sell without a connection: sellable items, the tax rates in force, payment methods and the walk-in customer. */
  catalogue(tenantId: string, deviceId: string, updatedSince?: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const d = first(await tx.select().from(posDevices).where(and(eq(posDevices.tenantId, tenantId), eq(posDevices.id, deviceId))), 'Device');
      if (d.status !== 'active') throw new AppError(403, 'device_revoked', 'This device was revoked');
      const terminal = first(await tx.select().from(posTerminals).where(and(eq(posTerminals.tenantId, tenantId), eq(posTerminals.id, d.terminalId))), 'Terminal');
      const since = updatedSince ?? '1970-01-01T00:00:00Z';
      const items = await tx.execute<{ id: string; code: string; name: string; hsn_sac_code: string | null; tax_code_id: string | null; item_type: string; is_stocked: boolean; tracking: string; status: string; updated_at: string }>(sql`
        SELECT id, code, name, hsn_sac_code, tax_code_id, item_type, is_stocked, tracking, status, updated_at::text FROM erp.items
         WHERE tenant_id = ${tenantId}::uuid AND is_sellable AND updated_at > ${since}::timestamptz ORDER BY code`);
      const rates = await tx.execute<{ tax_code_id: string; code: string; igst_rate: string; cgst_rate: string; sgst_rate: string; cess_rate: string }>(sql`
        SELECT r.tax_code_id, c.code, r.igst_rate::text, r.cgst_rate::text, r.sgst_rate::text, r.cess_rate::text FROM erp.tax_code_rates r JOIN erp.tax_codes c ON c.tenant_id = r.tenant_id AND c.id = r.tax_code_id
         WHERE r.tenant_id = ${tenantId}::uuid AND r.effective_from <= CURRENT_DATE AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE) ORDER BY c.code`);
      const methods = await tx.select({ method: posPaymentAccounts.method }).from(posPaymentAccounts).where(and(eq(posPaymentAccounts.tenantId, tenantId), eq(posPaymentAccounts.companyId, d.companyId)));
      const [settings] = await tx.select().from(posSettings).where(and(eq(posSettings.tenantId, tenantId), eq(posSettings.companyId, d.companyId)));
      return {
        serverTime: new Date().toISOString(), terminal: { id: terminal.id, code: terminal.code, warehouseId: terminal.warehouseId, gstRegistrationId: terminal.gstRegistrationId },
        walkInCustomerId: settings?.walkInCustomerId ?? null, paymentMethods: methods.map((m) => m.method).sort(),
        taxRates: rates.rows.map((r) => ({ taxCodeId: r.tax_code_id, code: r.code, igst: r.igst_rate, cgst: r.cgst_rate, sgst: r.sgst_rate, cess: r.cess_rate })),
        items: items.rows.map((i) => ({ id: i.id, code: i.code, name: i.name, hsn: i.hsn_sac_code, taxCodeId: i.tax_code_id, itemType: i.item_type, stocked: i.is_stocked, tracking: i.tracking, status: i.status, updatedAt: i.updated_at })),
      };
    }, { readOnly: true });
  }
}
