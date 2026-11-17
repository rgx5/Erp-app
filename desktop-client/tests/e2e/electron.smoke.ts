import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

// Launches the packaged-style app (out/ must be built) with its own throw-away user-data folder.
const launch = (userData: string) => electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: process.cwd() })

test('the desktop shell serves the app from a fixed origin, bridges settings, and remembers them across launches', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'onesync-ud-'))
  let app = await launch(userData)
  let page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: 'Connect to your server' })).toBeVisible()
  expect(page.url()).toMatch(/^app:\/\/onesync\//)
  expect(await page.evaluate(() => typeof (window as unknown as { onesync?: unknown }).onesync)).toBe('object')
  // nothing from Node leaks into the page
  expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
  const info = await page.evaluate(() => window.onesync?.info())
  expect(info).toMatchObject({ platform: process.platform })
  await page.evaluate(() => window.onesync?.settings.set({ serverUrl: 'https://erp.example.com', tenant: 'acme' }))
  await app.close()

  app = await launch(userData)
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible() // the saved server was found, so it skips the connect step
  expect(await page.evaluate(() => window.onesync?.settings.get())).toMatchObject({ serverUrl: 'https://erp.example.com', tenant: 'acme' })
  await app.close()
})

test('inside the desktop shell the app can sign in to the real backend (CORS allows its app:// origin)', async () => {
  const base = process.env['E2E_BACKEND_URL'] as string
  const slug = `shell-${Date.now().toString(36)}`
  const email = `owner@${slug}.example.com`
  const password = 'a long passphrase for tests 42'
  const made = await fetch(`${base}/v1/platform/tenants`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env['E2E_PLATFORM_TOKEN']}` }, body: JSON.stringify({ name: 'Shell Co', slug, owner: { email, displayName: 'Shell Owner', password } }) })
  expect(made.status).toBe(201)

  const app = await launch(mkdtempSync(join(tmpdir(), 'onesync-ud-')))
  const page = await app.firstWindow()
  await page.getByLabel('Server address').fill(base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(slug)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Shell Owner')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await app.close()
})
