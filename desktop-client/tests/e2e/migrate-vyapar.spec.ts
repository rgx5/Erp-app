import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { makeGstin } from '../seed'

const PASSWORD = 'a long passphrase for tests 42'
const FILE = process.env['VYAPAR_FILE'] ?? 'tests/fixtures/import/vyapar-sample.vyp'

test('migrate from Vyapar: a new business is set up from the backup file and its lists, items and stock come across', async ({ page }) => {
  test.setTimeout(process.env['VYAPAR_FILE'] ? 900_000 : 120_000)
  const base = process.env['E2E_BACKEND_URL'] as string
  const slug = `vy-${Date.now().toString(36)}`; const email = `owner@${slug}.example.com`
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`)
    return (await r.json()) as Record<string, any> // eslint-disable-line
  }
  await call('POST', '/v1/platform/tenants', { name: 'Migrating Co', slug, owner: { email, displayName: 'Owner', password: PASSWORD } }, process.env['E2E_PLATFORM_TOKEN'])
  const token = (await call('POST', '/v1/auth/login', { tenant: slug, email, password: PASSWORD })).accessToken as string

  await page.goto('/')
  await page.getByLabel('Server address').fill(base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(slug); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Dashboard|Set up your business/ })).toBeVisible()

  await goTo(page, 'Move from another program')
  await page.getByRole('button', { name: /Migrate from Vyapar/ }).click()
  await page.getByLabel('Vyapar backup file').setInputFiles({ name: 'backup.vyp', mimeType: 'application/octet-stream', buffer: readFileSync(FILE) })
  await expect(page.getByText(/Found in backup\.vyp/)).toBeVisible()
  await expect(page.getByText('Sunrise Tech Solutions')).toBeVisible()
  await expect(page.getByText('Not brought in yet')).toBeVisible()
  await page.getByLabel('Your GSTIN').fill(makeGstin('27', 'AAAAA0000A')) // the file's own GSTIN is a dummy that fails the check
  await page.getByRole('button', { name: 'Bring it in' }).click()
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible({ timeout: process.env['VYAPAR_FILE'] ? 840_000 : 90_000 })

  const count = async (path: string): Promise<number> => { let n = 0; let cursor = ''; do { const p = await call('GET', `${path}${path.includes('?') ? '&' : '?'}limit=200${cursor ? `&cursor=${cursor}` : ''}`, undefined, token); n += p['items'].length; cursor = p['nextCursor'] ?? '' } while (cursor); return n }
  const companies = await call('GET', '/v1/companies', undefined, token)
  expect(companies['items'][0].legalName).toBe('Sunrise Tech Solutions')
  const locs = await call('GET', `/v1/business-locations?companyId=${companies['items'][0].id}`, undefined, token)
  expect(locs['items'].length).toBe(1)
  expect(await count('/v1/parties')).toBeGreaterThan(20)
  expect(await count('/v1/items')).toBeGreaterThan(20)
  const stock = await call('GET', `/v1/stock/balances?companyId=${companies['items'][0].id}&limit=200`, undefined, token).catch(() => null)
  if (stock) expect(stock['items'].length).toBeGreaterThan(0)
  await expect(page.getByText(/Business "Sunrise Tech Solutions" created/)).toBeVisible()
  await expect(page.getByText(/were brought forward as of/)).toBeVisible()
  const ageing = await call('GET', `/v1/receivables/ageing?companyId=${companies['items'][0].id}&asOf=${new Date().toISOString().slice(0, 10)}`, undefined, token)
  expect(Number(ageing['totals']?.['total'] ?? ageing['total'])).toBeGreaterThan(1000)
  const payables = await call('GET', `/v1/payables/ageing?companyId=${companies['items'][0].id}&asOf=${new Date().toISOString().slice(0, 10)}`, undefined, token)
  expect(Number(payables['totals']?.['total'] ?? payables['total'])).toBeGreaterThanOrEqual(0)
  await expect(page.getByText(/negative stock/)).toBeVisible()
  await page.screenshot({ path: '/tmp/migrate-done.png', fullPage: true })
})
