import { MemoryStorage } from './memory'
import type { Storage } from './storage.types'

/** Default driver (Node, tests). Metro swaps in `driver.native.ts` on phones and `driver.web.ts` in the browser. */
export const createStorage = (): Storage => new MemoryStorage()
