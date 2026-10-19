import { createStorage } from './driver'
import type { Storage } from './storage.types'

let current: Storage = createStorage()

/** The app's persistent storage: SQLite on phones, localStorage on web, memory in tests. */
export const getStorage = (): Storage => current
/** Tests swap the implementation. */
export const setStorage = (s: Storage) => { current = s }
