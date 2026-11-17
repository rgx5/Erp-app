import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppFile } from '../../electron/main/serve'

describe('app:// file serving', () => {
  it('serves files, falls back to the app shell for routes, 404s missing assets and refuses traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'app-'))
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'index.html'), '<html></html>')
    await writeFile(join(root, 'assets', 'a.js'), 'x')
    expect(await resolveAppFile(root, 'app://onesync/assets/a.js')).toEqual({ path: join(root, 'assets', 'a.js'), type: 'text/javascript; charset=utf-8' })
    expect((await resolveAppFile(root, 'app://onesync/'))?.path).toBe(join(root, 'index.html'))
    expect((await resolveAppFile(root, 'app://onesync/sales/invoices'))?.path).toBe(join(root, 'index.html'))
    expect((await resolveAppFile(root, 'app://onesync/assets/missing.js'))?.path).toBe(join(root, 'assets', 'missing.js')) // a real 404 for the caller
    // traversal never leaves the folder: the dots are collapsed at the root, so these resolve to files *inside* it (here the app shell)
    for (const url of ['app://onesync/..%2f..%2fetc%2fpasswd', 'app://onesync/%2e%2e/%2e%2e/etc/passwd', 'app://onesync/assets/../../../etc/passwd']) {
      const r = await resolveAppFile(root, url)
      expect(r === null || r.path.startsWith(root), url).toBe(true)
      expect(r?.path, url).not.toContain('etc/passwd/..')
    }
  })
})
