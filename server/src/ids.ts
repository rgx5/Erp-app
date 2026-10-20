import { randomBytes } from 'node:crypto'

/** A random, unguessable id with a readable prefix (`org_3f9c…`). */
export const newId = (prefix: string, bytes = 10) => `${prefix}_${randomBytes(bytes).toString('hex')}`
