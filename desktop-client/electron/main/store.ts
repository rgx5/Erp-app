import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** A small JSON file written atomically (temp file, then rename), so a crash never leaves half a file. */
export class JsonFile<T extends object> {
  constructor(private readonly path: string, private readonly fallback: T) {}

  read(): T {
    try {
      return { ...this.fallback, ...(JSON.parse(readFileSync(this.path, 'utf8')) as T) }
    } catch {
      return { ...this.fallback }
    }
  }

  write(value: T): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
    renameSync(tmp, this.path)
  }
}
