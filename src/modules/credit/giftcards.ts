import { round2 } from '@/domain/money'
import { listOf, type DataState } from '@/data/state'
import type { GiftCard, GiftCardTxn } from './types'

/** What is left on a card: everything put on it, less everything spent. Never stored. */
export function giftCardBalance(state: DataState, cardId: string): number {
  let b = 0
  for (const t of listOf(state.giftCardTxns ?? {})) {
    if (t.cardId !== cardId) continue
    b += t.type === 'redeem' ? -t.amount : t.amount
  }
  return round2(b)
}

export const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/[\s]+/g, '')

export const findGiftCard = (state: DataState, code: string): GiftCard | undefined => {
  const c = normalizeCode(code)
  return c ? listOf(state.giftCards ?? {}).find((g) => g.code === c) : undefined
}

export interface CardCheck { card: GiftCard | null; balance: number; problem: string | null }

/** Whether a code can be spent now, and how much is on it. */
export function checkGiftCard(state: DataState, code: string, now: number): CardCheck {
  const card = findGiftCard(state, code)
  if (!card) return { card: null, balance: 0, problem: 'No gift card with that code' }
  const balance = giftCardBalance(state, card.id)
  if (!card.active) return { card, balance, problem: 'This card has been cancelled' }
  if (card.expiresAt && card.expiresAt < now) return { card, balance, problem: 'This card has expired' }
  if (balance <= 0) return { card, balance, problem: 'This card has nothing left on it' }
  return { card, balance, problem: null }
}

/** A readable code with no look-alike characters: GC-7KQ2-M9XA. `rnd` is injectable for tests. */
export function makeCode(taken: ReadonlySet<string>, rnd: () => number = Math.random): string {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  for (let tries = 0; tries < 50; tries++) {
    const pick = (n: number) => Array.from({ length: n }, () => A[Math.floor(rnd() * A.length)]).join('')
    const code = `GC-${pick(4)}-${pick(4)}`
    if (!taken.has(code)) return code
  }
  throw new Error('Could not make a unique gift-card code')
}

export const txnsOf = (state: DataState, cardId: string): GiftCardTxn[] =>
  listOf(state.giftCardTxns ?? {}).filter((t) => t.cardId === cardId).sort((a, b) => a.date - b.date)

/** Total owed to card holders (a liability), for the cards still active. */
export function outstandingGiftCards(state: DataState, now: number): { cards: number; amount: number } {
  let cards = 0, amount = 0
  for (const g of listOf(state.giftCards ?? {})) {
    if (!g.active) continue
    const b = giftCardBalance(state, g.id)
    if (b <= 0 || (g.expiresAt && g.expiresAt < now)) continue
    cards++; amount += b
  }
  return { cards, amount: round2(amount) }
}

/** Whether a card could pay `amount` now — the message to show if not. */
export function cardProblem(state: DataState, code: string, amount: number, now: number): string | null {
  const c = checkGiftCard(state, code, now)
  if (c.problem) return c.problem
  return amount > c.balance + 0.001 ? `Only ₹${c.balance} is left on this card` : null
}
