import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiskFileStore } from '../fileStore'
import { MAX_FILE_BYTES } from '../routes/files'
import { addStaff, maybe, pgAvailable, signup, startServer, type Biz, type TestServer } from './helpers'

jest.setTimeout(60_000)

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

describe('DiskFileStore', () => {
  let dir: string
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'kosh-files-')) })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('stores, reads and deletes bytes; refuses any key that could leave its folder', async () => {
    const f = new DiskFileStore(dir)
    await f.put('org_1/file_1', Buffer.from([1, 2, 3]))
    expect([...(await f.get('org_1/file_1'))!]).toEqual([1, 2, 3])
    expect(await f.get('org_1/missing')).toBeNull()
    await f.delete('org_1/file_1')
    expect(await f.get('org_1/file_1')).toBeNull()
    for (const bad of ['../x/y', 'a/../../etc', '/etc/passwd', 'a/b/c', 'a', 'a/b.txt', '', 'a\\b/c']) {
      await expect(f.put(bad, Buffer.from('x'))).rejects.toThrow('bad file key')
      await expect(f.get(bad)).rejects.toThrow('bad file key')
    }
  })
})

maybe('files', pgAvailable(), () => {
  let s: TestServer
  let owner: Biz
  let cashier: { id: string; token: string }
  let other: { id: string; token: string }
  beforeAll(async () => {
    s = await startServer('files')
    owner = await signup(s, 'File Shop')
    cashier = await addStaff(s, owner, 'cashier', 'Uploader')
    other = await addStaff(s, owner, 'cashier', 'Someone else')
  })
  afterAll(async () => { await s.close() })

  const upload = (token: string | undefined, bytes: Buffer, type = 'application/octet-stream', name?: string) =>
    s.call('POST', '/files', { token, raw: bytes, headers: { 'content-type': type, ...(name ? { 'x-filename': name } : {}) } })

  test('bytes go in and come out unchanged; the answer says where', async () => {
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31) % 256))
    const up = await upload(owner.token, bytes, 'application/octet-stream', 'blob.bin')
    expect(up.status).toBe(201)
    expect(up.json).toMatchObject({ size: 5000, url: `/files/${up.json.id}`, name: 'blob.bin' })
    const down = await s.call('GET', up.json.url, { token: owner.token })
    expect(down.status).toBe(200)
    expect(Buffer.compare(down.raw, bytes)).toBe(0)
    // stored through the FileStore, under the business's own folder
    expect([...s.files.files.keys()]).toContain(`${owner.orgId}/${up.json.id}`)
  })

  test('only signed-in people can upload or read', async () => {
    expect((await upload(undefined, PNG, 'image/png')).status).toBe(401)
    const up = await upload(owner.token, PNG, 'image/png', 'x.png')
    expect((await s.call('GET', up.json.url)).status).toBe(401)
    expect((await s.call('GET', up.json.url, { token: 'nope' })).status).toBe(401)
  })

  test('empty uploads, JSON bodies and oversize files are refused', async () => {
    expect((await upload(owner.token, Buffer.alloc(0))).status).toBe(400)
    const json = await s.call('POST', '/files', { token: owner.token, body: { not: 'a file' } })
    expect(json.status).toBe(400)
    const big = await upload(owner.token, Buffer.alloc(MAX_FILE_BYTES + 1, 7), 'application/octet-stream')
    expect(big.status).toBe(413)
    expect(big.json.code).toBe('too_large')
    const justFits = await upload(owner.token, Buffer.alloc(MAX_FILE_BYTES, 7), 'application/octet-stream')
    expect(justFits.status).toBe(201)
  })

  test('images and PDFs show inline; everything else (HTML, SVG, scripts) downloads, sandboxed', async () => {
    const png = await upload(owner.token, PNG, 'image/png', 'pic.png')
    const g = await s.call('GET', png.json.url, { token: owner.token })
    expect(g.headers['content-type']).toBe('image/png')
    expect(String(g.headers['content-disposition'])).toMatch(/^inline;/)
    for (const evil of ['text/html', 'image/svg+xml', 'application/javascript']) {
      const up = await upload(owner.token, Buffer.from('<script>alert(1)</script>'), evil, 'evil.html')
      const r = await s.call('GET', up.json.url, { token: owner.token })
      expect(r.headers['content-type']).toBe('application/octet-stream')
      expect(String(r.headers['content-disposition'])).toMatch(/^attachment;/)
      expect(String(r.headers['content-security-policy'])).toContain('sandbox')
      expect(r.headers['x-content-type-options']).toBe('nosniff')
    }
  })

  test('file names are cleaned: no paths, quotes or line breaks reach a header', async () => {
    const up = await upload(owner.token, PNG, 'image/png', encodeURIComponent('../../etc/pa"ss\r\nwd.png'))
    expect(up.status).toBe(201)
    expect(up.json.name).not.toMatch(/[\\/"\r\n]/)
    const r = await s.call('GET', up.json.url, { token: owner.token })
    expect(String(r.headers['content-disposition'])).not.toMatch(/[\r\n]/)
    expect(String(r.headers['content-disposition']).match(/"/g)).toHaveLength(2)
  })

  test('only the owner or the uploader can delete', async () => {
    const up = await upload(cashier.token, PNG, 'image/png', 'mine.png')
    expect((await s.call('DELETE', up.json.url, { token: other.token })).status).toBe(403)
    expect((await s.call('GET', up.json.url, { token: other.token })).status).toBe(200) // everyone in the business can read
    expect((await s.call('DELETE', up.json.url, { token: cashier.token })).status).toBe(200)
    expect((await s.call('GET', up.json.url, { token: owner.token })).status).toBe(404)
    expect(s.files.files.has(`${owner.orgId}/${up.json.id}`)).toBe(false)
    const up2 = await upload(cashier.token, PNG, 'image/png')
    expect((await s.call('DELETE', up2.json.url, { token: owner.token })).status).toBe(200)
    expect((await s.call('DELETE', up2.json.url, { token: owner.token })).status).toBe(404)
  })

  test('a made-up id is just not found', async () => {
    expect((await s.call('GET', '/files/file_doesnotexist', { token: owner.token })).status).toBe(404)
    expect((await s.call('GET', '/files/..%2F..%2Fetc%2Fpasswd', { token: owner.token })).status).toBe(404)
  })
})
