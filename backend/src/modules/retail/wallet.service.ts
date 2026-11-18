import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, toPage } from '../../platform/http/validation.js';
import { fromUnits, toUnits } from '../accounting/money.js';
import { first, Recorder, updateVersioned } from '../masterdata/helpers.js';
import { parties } from '../masterdata/masterdata.schema.js';
import { ReceivablesService } from '../sales/receivables.service.js';
import { couponRedemptions, coupons, loyaltyLedger, posWalletUses, retailSettings } from './retail.schema.js';
import type { CreateCouponInput } from './wallet.schemas.js';

export type CouponRow = typeof coupons.$inferSelect;
const today = (): string => new Date().toISOString().slice(0, 10);
const money4 = (u: bigint): string => fromUnits(u);
/** points are held to 2 decimals: scale 100 */
const pts = (text: string): bigint => { const neg = text.startsWith('-'); const [i = '0', f = ''] = text.replace('-', '').split('.'); const v = BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2)); return neg ? -v : v; };
const ptsText = (v: bigint): string => { const neg = v < 0n; const a = neg ? -v : v; return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`; };

export interface CouponCheck { valid: true; couponId: string; code: string; kind: string; value: string; discount: string; description: string | null }

/**
 * The customer wallet at the counter. Store credit is the customer's unapplied credit in receivables (allocated to the new invoice
 * when used); loyalty points live in their own ledger; coupons are eligibility rules with a use count. The till applies the discount a
 * coupon or redeemed points give; the server checks that the right to it exists (balance, dates, minimum bill, uses left) and records it.
 */
@Injectable()
export class WalletService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(ReceivablesService) private readonly receivables: ReceivablesService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- settings -------------------------------------------------------------------------------------------------------
  getSettings(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [s] = await tx.select().from(retailSettings).where(and(eq(retailSettings.tenantId, tenantId), eq(retailSettings.companyId, companyId)));
      return s ?? { companyId, loyaltyPointsPerHundred: '0.0000', loyaltyRupeesPerPoint: '0.0000', version: 0 };
    }, { readOnly: true });
  }
  putSettings(tenantId: string, companyId: string, input: { loyaltyPointsPerHundred?: string | undefined; loyaltyRupeesPerPoint?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const set = { ...(input.loyaltyPointsPerHundred !== undefined ? { loyaltyPointsPerHundred: input.loyaltyPointsPerHundred } : {}), ...(input.loyaltyRupeesPerPoint !== undefined ? { loyaltyRupeesPerPoint: input.loyaltyRupeesPerPoint } : {}), updatedAt: new Date() };
      const row = first(await tx.insert(retailSettings).values({ tenantId, companyId, ...set }).onConflictDoUpdate({ target: [retailSettings.tenantId, retailSettings.companyId], set: { ...set, version: sql`${retailSettings.version} + 1` } }).returning(), 'Retail settings');
      await this.recorder.record(tx, tenantId, 'retail_settings', 'updated', { id: companyId }, { fields: Object.keys(input) });
      return row;
    });
  }

  // ---- the wallet of one customer ----------------------------------------------------------------------------------
  async balance(tx: Tx, tenantId: string, companyId: string, customerId: string): Promise<bigint> {
    const [r] = await tx.select({ s: sql<string>`COALESCE(SUM(${loyaltyLedger.points}), 0)::text` }).from(loyaltyLedger).where(and(eq(loyaltyLedger.tenantId, tenantId), eq(loyaltyLedger.companyId, companyId), eq(loyaltyLedger.customerId, customerId)));
    return pts(r?.s ?? '0');
  }

  wallet(tenantId: string, companyId: string, customerId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const customer = first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, customerId))), 'Customer');
      const position = await this.receivables.position(tenantId, companyId, customerId, today());
      const [settings] = await tx.select().from(retailSettings).where(and(eq(retailSettings.tenantId, tenantId), eq(retailSettings.companyId, companyId)));
      const points = await this.balance(tx, tenantId, companyId, customerId);
      const per = settings?.loyaltyRupeesPerPoint ?? '0';
      const history = await tx.select().from(loyaltyLedger).where(and(eq(loyaltyLedger.tenantId, tenantId), eq(loyaltyLedger.companyId, companyId), eq(loyaltyLedger.customerId, customerId))).orderBy(desc(loyaltyLedger.id)).limit(20);
      return {
        customer: { id: customer.id, code: customer.code, name: customer.tradeName ?? customer.legalName },
        storeCredit: position.totalUnapplied, storeCreditItems: position.unapplied,
        loyalty: { points: ptsText(points), rupeesPerPoint: per, value: money4((points * toUnits(per)) / 100n) },
        history: history.map((h) => ({ id: h.id, points: h.points, kind: h.kind, note: h.note, createdAt: h.createdAt.toISOString() })),
      };
    }, { readOnly: true });
  }

  adjustPoints(tenantId: string, actorId: string, input: { companyId: string; customerId: string; points: string; note: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      first(await tx.select({ id: parties.id }).from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, input.customerId))), 'Customer');
      const bal = await this.balance(tx, tenantId, input.companyId, input.customerId);
      if (bal + pts(input.points) < 0n) throw new AppError(409, 'negative_points', `The customer has only ${ptsText(bal)} points`);
      const row = first(await tx.insert(loyaltyLedger).values({ tenantId, id: uuidv7(), companyId: input.companyId, customerId: input.customerId, points: input.points, kind: 'adjust', note: input.note, createdBy: actorId }).returning(), 'Points');
      await this.recorder.record(tx, tenantId, 'loyalty', 'adjusted', row, { customerId: input.customerId, points: input.points });
      return { points: ptsText(bal + pts(input.points)) };
    });
  }

  // ---- coupons --------------------------------------------------------------------------------------------------------
  createCoupon(tenantId: string, input: CreateCouponInput): Promise<CouponRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      try {
        return await this.recorder.record(tx, tenantId, 'coupon', 'created', first(await tx.insert(coupons).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Coupon'), { code: input.code });
      } catch (e) { if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw new AppError(409, 'coupon_exists', 'A coupon with that code already exists'); throw e; }
    });
  }
  async listCoupons(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; status?: 'active' | 'inactive' | undefined }) {
    const before = decodeCursor(q.cursor);
    const rows = await this.uow.inTenant(tenantId, (tx) => tx.select().from(coupons).where(and(eq(coupons.tenantId, tenantId), eq(coupons.companyId, q.companyId), q.status ? eq(coupons.status, q.status) : undefined, before ? sql`${coupons.id} < ${before}::uuid` : undefined)).orderBy(desc(coupons.id)).limit(q.limit + 1), { readOnly: true });
    return toPage(rows, q.limit);
  }
  updateCoupon(tenantId: string, id: string, version: number, input: Record<string, unknown>): Promise<CouponRow> {
    return this.uow.inTenant(tenantId, async (tx) => this.recorder.record(tx, tenantId, 'coupon', 'updated', await updateVersioned<CouponRow>(tx, coupons, tenantId, id, version, input, 'Coupon'), { fields: Object.keys(input) }));
  }

  private async findCoupon(tx: Tx, tenantId: string, companyId: string, code: string): Promise<CouponRow> {
    const [c] = await tx.select().from(coupons).where(and(eq(coupons.tenantId, tenantId), eq(coupons.companyId, companyId), sql`lower(${coupons.code}) = lower(${code})`));
    if (!c) throw new AppError(404, 'coupon_not_found', 'No coupon has that code');
    return c;
  }
  /** Is this coupon usable on a bill of this size today, and what would it take off? Does not use it up. */
  private check(c: CouponRow, billTotal: bigint, date: string): CouponCheck {
    if (c.status !== 'active') throw new AppError(409, 'coupon_inactive', 'This coupon is not active');
    if (c.validFrom && date < c.validFrom) throw new AppError(409, 'coupon_not_started', `This coupon is valid from ${c.validFrom}`);
    if (c.validTo && date > c.validTo) throw new AppError(409, 'coupon_expired', `This coupon expired on ${c.validTo}`);
    if (c.maxUses !== null && c.usedCount >= c.maxUses) throw new AppError(409, 'coupon_used_up', 'This coupon has been used the most times it allows');
    if (billTotal < toUnits(c.minBill)) throw new AppError(409, 'coupon_min_bill', `This coupon needs a bill of at least ${c.minBill}`, { minBill: c.minBill });
    let d = c.kind === 'percent' ? (billTotal * toUnits(c.value)) / 1_000_000n : toUnits(c.value);
    if (c.maxDiscount !== null && d > toUnits(c.maxDiscount)) d = toUnits(c.maxDiscount);
    if (d > billTotal) d = billTotal;
    return { valid: true, couponId: c.id, code: c.code, kind: c.kind, value: c.value, discount: money4(d), description: c.description };
  }
  validateCoupon(tenantId: string, input: { companyId: string; code: string; billTotal: string; date?: string | undefined }): Promise<CouponCheck> {
    return this.uow.inTenant(tenantId, async (tx) => this.check(await this.findCoupon(tx, tenantId, input.companyId, input.code), toUnits(input.billTotal), input.date ?? today()), { readOnly: true });
  }

  // ---- used by a counter sale (inside its transaction) ------------------------------------------------------------
  /** Records a coupon use against a sale; the use count rises under a row lock so the limit holds with two tills. */
  async redeemCoupon(tx: Tx, tenantId: string, p: { companyId: string; code: string; saleId: string; customerId: string | null; billTotal: string; date: string }): Promise<void> {
    const c0 = await this.findCoupon(tx, tenantId, p.companyId, p.code);
    const [c] = await tx.select().from(coupons).where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, c0.id))).for('update');
    const check = this.check(c as CouponRow, toUnits(p.billTotal), p.date);
    await tx.update(coupons).set({ usedCount: sql`${coupons.usedCount} + 1` }).where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, c0.id)));
    await tx.insert(couponRedemptions).values({ tenantId, id: uuidv7(), couponId: c0.id, posSaleId: p.saleId, customerId: p.customerId, billTotal: p.billTotal });
    await tx.insert(posWalletUses).values({ tenantId, id: uuidv7(), posSaleId: p.saleId, kind: 'coupon', amount: check.discount, reference: c0.code });
  }

  async redeemPoints(tx: Tx, tenantId: string, actorId: string, p: { companyId: string; customerId: string; points: string; saleId: string; grandTotal: string }): Promise<string> {
    const [settings] = await tx.select().from(retailSettings).where(and(eq(retailSettings.tenantId, tenantId), eq(retailSettings.companyId, p.companyId)));
    const per = settings?.loyaltyRupeesPerPoint ?? '0';
    if (toUnits(per) === 0n) throw new AppError(409, 'loyalty_not_configured', 'Set what a point is worth in the retail settings first');
    const bal = await this.balance(tx, tenantId, p.companyId, p.customerId);
    if (pts(p.points) > bal) throw new AppError(409, 'insufficient_points', `The customer has only ${ptsText(bal)} points`, { points: ptsText(bal) });
    const value = (pts(p.points) * toUnits(per)) / 100n;
    await tx.insert(loyaltyLedger).values({ tenantId, id: uuidv7(), companyId: p.companyId, customerId: p.customerId, points: ptsText(-pts(p.points)), kind: 'redeem', refType: 'pos_sale', refId: p.saleId, createdBy: actorId });
    await tx.insert(posWalletUses).values({ tenantId, id: uuidv7(), posSaleId: p.saleId, kind: 'points_redeemed', amount: money4(value), points: p.points });
    return money4(value);
  }

  /** Points earned on what the customer paid (the sale total after any discount). Walk-in sales earn nothing. */
  async earnPoints(tx: Tx, tenantId: string, actorId: string, p: { companyId: string; customerId: string; saleId: string; grandTotal: string }): Promise<string | null> {
    const [settings] = await tx.select().from(retailSettings).where(and(eq(retailSettings.tenantId, tenantId), eq(retailSettings.companyId, p.companyId)));
    const per = toUnits(settings?.loyaltyPointsPerHundred ?? '0');
    if (per === 0n) return null;
    const earned = (toUnits(p.grandTotal) * per) / 100_000_000n; // total x points-per-hundred / 100, as hundredths of a point (both are 4-dp numbers), rounded down
    if (earned <= 0n) return null;
    const text = ptsText(earned);
    await tx.insert(loyaltyLedger).values({ tenantId, id: uuidv7(), companyId: p.companyId, customerId: p.customerId, points: text, kind: 'earn', refType: 'pos_sale', refId: p.saleId, createdBy: actorId });
    await tx.insert(posWalletUses).values({ tenantId, id: uuidv7(), posSaleId: p.saleId, kind: 'points_earned', amount: '0', points: text });
    return text;
  }

  /** Settles part of an invoice from the customer's unapplied credit, oldest first. */
  async useStoreCredit(tx: Tx, tenantId: string, actorId: string, p: { companyId: string; customerId: string; invoiceId: string; amount: string; date: string; saleId: string }): Promise<void> {
    const position = await this.receivables.position(tenantId, p.companyId, p.customerId, p.date);
    const sources = [...position.unapplied].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
    let left = toUnits(p.amount);
    const have = sources.reduce((s, x) => s + toUnits(x.amount), 0n);
    if (left > have) throw new AppError(409, 'insufficient_store_credit', `The customer has only ${fromUnits(have)} of store credit`, { available: fromUnits(have) });
    for (const src of sources) {
      if (left <= 0n) break;
      const take = toUnits(src.amount) < left ? toUnits(src.amount) : left;
      await this.receivables.allocate(tenantId, actorId, { source: { type: src.kind === 'receipt' ? 'receipt' : 'credit_note', id: src.id }, allocatedOn: p.date, allocations: [{ invoiceId: p.invoiceId, amount: fromUnits(take) }] });
      left -= take;
    }
    await tx.insert(posWalletUses).values({ tenantId, id: uuidv7(), posSaleId: p.saleId, kind: 'store_credit_used', amount: p.amount });
  }

  async recordCreditIssued(tx: Tx, tenantId: string, p: { saleId: string; amount: string; creditNoteNo: string }): Promise<void> {
    await tx.insert(posWalletUses).values({ tenantId, id: uuidv7(), posSaleId: p.saleId, kind: 'store_credit_issued', amount: p.amount, reference: p.creditNoteNo });
  }

  usesOf(tx: Tx, tenantId: string, saleId: string) {
    return tx.select().from(posWalletUses).where(and(eq(posWalletUses.tenantId, tenantId), eq(posWalletUses.posSaleId, saleId)));
  }
}

export { validationFailed };
