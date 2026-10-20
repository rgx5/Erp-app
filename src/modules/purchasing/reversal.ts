/**
 * Posted documents are never edited. A mistake is cancelled by a *reversal*: a new document of the same shape that names the
 * original in `reverses`. Its effects are the original's, negated; its posting is the original's, turned the other way round.
 * Everything that adds documents up (what we owe, the ITC register) skips both the original and its reversal.
 */
export interface MaybeReversal { id: string; reverses?: string }

/** The ids that have been cancelled. */
export const reversedIds = (docs: MaybeReversal[]): Set<string> => new Set(docs.filter((d) => d.reverses).map((d) => d.reverses as string))

/** The documents still standing: not a reversal, and not reversed. */
export function live<T extends MaybeReversal>(docs: T[]): T[] {
  const gone = reversedIds(docs)
  return docs.filter((d) => !d.reverses && !gone.has(d.id))
}

/** +1 for a document, −1 for the reversal of one. */
export const sign = (d: { reverses?: string }) => (d.reverses ? -1 : 1)
