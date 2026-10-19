import { create } from 'zustand'

/** A receipt waiting to be filled in — handed from the reorder list to the goods-receipt form, then used up. */
export interface PurchaseDraft { supplierId: string; lines: Array<{ variantId: string; qty: number }> }

interface DraftStore {
  draft: PurchaseDraft | null
  set: (d: PurchaseDraft) => void
  /** Reads the draft and clears it, so a later "Receive stock" starts empty. */
  take: () => PurchaseDraft | null
}

export const usePurchaseDraft = create<DraftStore>((set, get) => ({
  draft: null,
  set: (draft) => set({ draft }),
  take: () => { const d = get().draft; set({ draft: null }); return d },
}))
