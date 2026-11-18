import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { seedBusiness } from '../seed'

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
  expect(Array.isArray(await page.evaluate(() => window.onesync?.printer.list()))).toBe(true) // printers are listed (possibly none on a build machine)
  await expect(page.evaluate(() => window.onesync?.printer.printReceipt('<p>x</p>', 'No such printer'))).rejects.toThrow() // an unknown printer is refused
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

test('inside the desktop shell an invoice can be saved as an A4 PDF', async () => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'pdf' })
  const inv = await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: new Date().toISOString().slice(0, 10), customerId: s.customer.id, lines: [{ itemId: s.widget.id, quantity: '2', unitPrice: '1000', warehouseId: s.warehouse.id }] })
  const target = join(mkdtempSync(join(tmpdir(), 'onesync-pdf-')), 'invoice.pdf')
  const app = await launch(mkdtempSync(join(tmpdir(), 'onesync-ud-')))
  // answer the "save as" dialog without a person: the real dialog is exercised by hand
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never }, target)
  const page = await app.firstWindow()
  await page.getByLabel('Server address').fill(s.base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug)
  await page.getByLabel('Email').fill(s.email)
  await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await page.evaluate((id) => { location.hash = `#/sales/invoices/${id}` }, inv.id)
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible()
  await page.getByRole('button', { name: 'Save as PDF' }).click()
  await expect.poll(() => existsSync(target), { timeout: 20_000 }).toBe(true)
  expect(readFileSync(target).subarray(0, 5).toString()).toBe('%PDF-')
  expect(statSync(target).size).toBeGreaterThan(2_000)
  await app.close()
})
