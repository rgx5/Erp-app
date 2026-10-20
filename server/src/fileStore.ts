import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Where uploaded bytes live. The server only ever asks for `orgId/fileId` keys it generated itself. */
export interface FileStore {
  put(key: string, bytes: Buffer): Promise<void>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
}

/** Files on local disk. Keys are validated to plain `[a-z0-9_-]+/[a-z0-9_-]+` so no path can escape the base directory. */
export class DiskFileStore implements FileStore {
  private readonly base: string

  constructor(dir: string) { this.base = resolve(dir) }

  private path(key: string) {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(key)) throw new Error('bad file key')
    const p = resolve(join(this.base, key))
    if (!p.startsWith(this.base)) throw new Error('bad file key')
    return p
  }

  async put(key: string, bytes: Buffer) {
    const p = this.path(key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, bytes)
  }

  async get(key: string) {
    try { return await readFile(this.path(key)) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  }

  async delete(key: string) { await rm(this.path(key), { force: true }) }
}

/** In memory, for tests. */
export class MemoryFileStore implements FileStore {
  files = new Map<string, Buffer>()
  async put(key: string, bytes: Buffer) { this.files.set(key, bytes) }
  async get(key: string) { return this.files.get(key) ?? null }
  async delete(key: string) { this.files.delete(key) }
}
