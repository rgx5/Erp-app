import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { fromUnits, toUnits } from '../accounting/money.js';
import { PostingService } from '../accounting/posting.service.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { giftCardEntries, giftCards, posPaymentAccounts, posShifts, posTerminals } from './pos.schema.js';
import type { IssueGiftCardInput } from './pos.schemas.js';

/** No 0/O or 1/I: a code read out over the counter or typed from a printed card is not mistaken. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = (): string => 'GC-' + [0, 1, 2].map(() => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')).join('-');
export const normaliseCode = (v: string): string => v.trim().toUpperCase().replaceAll(' ', '');
const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Gift cards. Selling one is not income: the money is a liability (what the shop owes the holder) until the card is spent. Spending
 * one at the counter is an ordinary payment method whose account is that liability, so the sale posts as it always does and the
 * liability is released. The balance is guarded by the database (never below zero), so two counters cannot spend the same value twice.
 */
@Injectable()
export class GiftCardService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  private async account(tx: Tx, tenantId: string, companyId: string, method: string): Promise<string | undefined> {
    const [r] = await tx.select().from(posPaymentAccounts).where(and(eq(posPaymentAccounts.tenantId, tenantId), eq(posPaymentAccounts.companyId, companyId), eq(posPaymentAccounts.method, method)));
    return r?.accountId;
  }

  /** Sells a new card at the counter, taking the money into the open shift. */
  issue(tenantId: string, actorId: string, input: IssueGiftCardInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const shift = first(await tx.select().from(posShifts).where(and(eq(posShifts.tenantId, tenantId), eq(posShifts.id, input.shiftId))).for('update'), 'Shift');
      if (shift.status !== 'open') throw new AppError(409, 'shift_closed', `Shift ${shift.shiftNo} is closed`);
      void first(await tx.select().from(posTerminals).where(and(eq(posTerminals.tenantId, tenantId), eq(posTerminals.id, shift.terminalId))), 'Terminal');
      const liability = await this.account(tx, tenantId, shift.companyId, 'gift_card');
      if (!liability) throw new AppError(409, 'pos_not_configured', 'Map the gift card method to a liability account in the POS settings first');
      const received = await this.account(tx, tenantId, shift.companyId, input.method);
      if (!received) throw new AppError(409, 'pos_not_configured', `Map the ${input.method} payment method to an account in the POS settings first`);
      const date = input.date ?? today();
      if (input.expiresOn && input.expiresOn < date) throw validationFailed([{ path: 'expiresOn', message: 'The card cannot expire before today' }]);
      const id = uuidv7();
      const { entry } = await this.posting.post(tx, tenantId, {
        companyId: shift.companyId, postingDate: date, journalType: 'system', description: 'Gift card sold',
        lines: [{ accountId: received, debit: input.amount, description: 'Gift card sold' }, { accountId: liability, credit: input.amount, description: 'Gift card sold' }],
        source: { type: 'gift_card', id, event: 'issue' }, postedBy: actorId,
      });
      let code = makeCode();
      for (let i = 0; i < 5; i++) {
        const [clash] = await tx.select({ id: giftCards.id }).from(giftCards).where(and(eq(giftCards.tenantId, tenantId), eq(giftCards.code, code)));
        if (!clash) break;
        code = makeCode();
      }
      const card = first(await tx.insert(giftCards).values({ tenantId, id, companyId: shift.companyId, code, initialAmount: input.amount, balance: input.amount, holderName: input.holderName ?? null, expiresOn: input.expiresOn ?? null }).returning(), 'Gift card');
      await tx.insert(giftCardEntries).values({ tenantId, id: uuidv7(), cardId: card.id, kind: 'issue', amount: input.amount, method: input.method, shiftId: shift.id, journalEntryId: entry.id, createdBy: actorId });
      return this.recorder.record(tx, tenantId, 'gift_card', 'issued', card, { code, amount: input.amount, method: input.method, shiftNo: shift.shiftNo });
    });
  }

  /** Spends part of a card against a counter sale. Runs inside the sale's transaction; refuses an unknown, expired or short card. */
  async redeem(tx: Tx, tenantId: string, actorId: string, p: { companyId: string; code: string; amount: string; date: string; saleId: string; shiftId: string }) {
    const code = normaliseCode(p.code);
    if (!code) throw validationFailed([{ path: 'payments', message: 'Enter the gift card code as the reference' }]);
    const [card] = await tx.select().from(giftCards).where(and(eq(giftCards.tenantId, tenantId), eq(giftCards.companyId, p.companyId), eq(giftCards.code, code))).for('update');
    if (!card) throw new AppError(404, 'gift_card_not_found', `No gift card ${code}`);
    if (card.status !== 'active') throw new AppError(409, 'gift_card_inactive', 'This gift card is not active');
    if (card.expiresOn && card.expiresOn < p.date) throw new AppError(409, 'gift_card_expired', `This gift card expired on ${card.expiresOn}`);
    const left = toUnits(card.balance) - toUnits(p.amount);
    if (left < 0n) throw new AppError(409, 'gift_card_insufficient', `The card has only ${fromUnits(toUnits(card.balance))} left`, { balance: card.balance });
    await tx.update(giftCards).set({ balance: fromUnits(left), version: sql`${giftCards.version} + 1`, updatedAt: new Date() }).where(and(eq(giftCards.tenantId, tenantId), eq(giftCards.id, card.id)));
    await tx.insert(giftCardEntries).values({ tenantId, id: uuidv7(), cardId: card.id, kind: 'redeem', amount: p.amount, posSaleId: p.saleId, shiftId: p.shiftId, createdBy: actorId });
    await this.recorder.record(tx, tenantId, 'gift_card', 'redeemed', card, { code, amount: p.amount, saleId: p.saleId });
  }

  /** What a card holds. */
  lookup(tenantId: string, companyId: string, rawCode: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const code = normaliseCode(rawCode);
      const [card] = await tx.select().from(giftCards).where(and(eq(giftCards.tenantId, tenantId), eq(giftCards.companyId, companyId), eq(giftCards.code, code)));
      if (!card) throw new AppError(404, 'gift_card_not_found', `No gift card ${code}`);
      return card;
    }, { readOnly: true });
  }

  /** Cards with the value still outstanding (what the shop owes holders). */
  list(tenantId: string, companyId: string, limit: number) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(giftCards).where(and(eq(giftCards.tenantId, tenantId), eq(giftCards.companyId, companyId))).orderBy(desc(giftCards.createdAt)).limit(limit);
      const [t] = await tx.select({ owed: sql<string>`COALESCE(SUM(${giftCards.balance}), 0)::text` }).from(giftCards).where(and(eq(giftCards.tenantId, tenantId), eq(giftCards.companyId, companyId), eq(giftCards.status, 'active')));
      return { items: rows, outstanding: t?.owed ?? '0' };
    }, { readOnly: true });
  }
}
