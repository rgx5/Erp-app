import type { Line } from '@/features/sales/LineGrid'

/** Lines handed from another screen (the reorder list) to the new purchase order screen, taken once. */
let draft: Line[] | null = null
export const setPoDraft = (lines: Line[]): void => { draft = lines }
export const takePoDraft = (): Line[] | null => { const d = draft; draft = null; return d }
