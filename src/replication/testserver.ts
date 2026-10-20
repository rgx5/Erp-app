import { actorWith } from './testkit'
import type { Actor } from './types'

export { applyMutations, pullChanges } from './apply'
export { MemoryDocStore } from './memory'

/** The two kinds of person a fake server knows: the owner (everything) and a cashier (the counter and customers). */
export const actorFor = (who: 'owner' | 'cashier'): Actor => (who === 'cashier' ? actorWith(['pos', 'customers'], 'u_cash') : actorWith('all'))
