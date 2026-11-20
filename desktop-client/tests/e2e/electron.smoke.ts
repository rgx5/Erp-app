import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { seedBusiness } from '../seed'

// Launches the packaged-style app (out/ must be built) with its own throw-away user-data folder.
/** The app's own window: the first window is the start-up splash. */
const appWindow = async (app: ElectronApplication) => {
  for (let i = 0; i < 100; i++) { const w = app.windows().find((x) => x.url().startsWith('app://')); if (w) return w; await new Promise((r) => setTimeout(r, 100)) }
  throw new Error('The app window did not open')
}
const launch = (userData: string) => electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: process.cwd() })

test('the desktop shell serves the app from a fixed origin, bridges settings, and remembers them across launches', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'onesync-ud-'))
  let app = await launch(userData)
  let page = await appWindow(app)
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
  page = await appWindow(app)
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
  const page = await appWindow(app)
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
  const page = await appWindow(app)
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

test('a counter restarted with no connection still opens, finds its items and sells', async () => {
  const { createServer, connect } = await import('node:net')
  const backend = new URL(process.env['E2E_BACKEND_URL'] as string)
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'off' })
  const c = s.company.id
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as { id: string; code: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  await s.call('PUT', `/v1/pos/settings?companyId=${c}`, { walkInCustomerId: s.walkIn.id, cashVarianceAccountId: a('5900') })
  for (const [m, code] of [['cash', '1110'], ['upi', '1120'], ['card', '1120'], ['bank_transfer', '1120'], ['cheque', '1120'], ['other', '1120']]) await s.call('PUT', `/v1/pos/payment-accounts?companyId=${c}`, { method: m, accountId: a(code as string) })
  await s.call('POST', '/v1/pos/terminals', { companyId: c, code: 'T1', name: 'Counter 1', gstRegistrationId: s.registration.id, businessLocationId: s.location.id, warehouseId: s.warehouse.id })
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const list = await s.call('POST', '/v1/price-lists', { code: 'COUNTER', name: 'Counter prices', kind: 'sales', taxInclusive: true })
  await s.call('POST', `/v1/price-lists/${list.id}/prices`, { itemId: s.cheap.id, uomId: nos.id, price: '105', effectiveFrom: `${s.year}-04-01` })

  // the app talks to the backend through a pipe that this test can cut, like a network that goes away
  const sockets = new Set<import('node:net').Socket>()
  const open = (port: number) => new Promise<import('node:net').Server>((ok) => { const srv = createServer((cl) => { const up = connect(Number(backend.port), backend.hostname); sockets.add(cl); sockets.add(up); cl.pipe(up).pipe(cl); cl.on('error', () => up.destroy()); up.on('error', () => cl.destroy()) }); srv.listen(port, '127.0.0.1', () => ok(srv)) })
  let pipe = await open(0); const port = (pipe.address() as { port: number }).port
  const userData = mkdtempSync(join(tmpdir(), 'onesync-ud-'))
  const launchLocal = () => electron.launch({ args: ['.', '--no-sandbox', '--password-store=basic', `--user-data-dir=${userData}`], cwd: process.cwd() })

  // a build machine has no keychain: use Electron's plain-text store so the sign-in can be remembered here (a real computer uses its own)
  const plainText = (a: Awaited<ReturnType<typeof launchLocal>>) => a.evaluate(({ safeStorage }) => { (safeStorage as unknown as { setUsePlainTextEncryption?: (v: boolean) => void }).setUsePlainTextEncryption?.(true) })
  let app = await launchLocal(); await plainText(app); let page = await appWindow(app)
  const secure = (await page.evaluate(() => window.onesync?.info()))?.secureStorage
  test.skip(!secure, 'this computer has no secure store, so nothing is remembered between launches')
  await page.getByLabel('Server address').fill(`http://127.0.0.1:${port}`)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await page.keyboard.press('Control+k'); await page.getByLabel('Search or run a command').last().fill('Counter'); await page.getByLabel('Search or run a command').last().press('Enter')
  await page.getByLabel('Sell from price list').selectOption({ label: 'Counter prices (prices include tax)' })
  await page.getByLabel('Cash in the drawer').fill('500')
  await page.getByRole('button', { name: 'Open shift' }).click()
  await expect(page.getByLabel('Item list status')).toContainText(/items on this counter/)
  await page.waitForTimeout(4000) // the on-disk copy is written a moment after the last change
  await app.close()

  // the network goes away, and the counter is started again
  pipe.close(); for (const sk of sockets) sk.destroy()
  app = await launchLocal(); await plainText(app); page = await appWindow(app)
  await expect(page.getByText(/Working offline/)).toBeVisible({ timeout: 30_000 }) // not the sign-in screen
  await page.keyboard.press('Control+k'); await page.getByLabel('Search or run a command').last().fill('Counter'); await page.getByLabel('Search or run a command').last().press('Enter')
  await expect(page.getByLabel(/Scan or type item/)).toBeVisible({ timeout: 20_000 }) // the open shift and terminal came from this computer
  await expect(page.getByLabel('Item list status')).toContainText(/items on this counter/)
  await page.getByLabel(/Scan or type item/).fill('toy'); await page.keyboard.press('Enter')
  await expect(page.getByRole('table', { name: 'Cart' })).toContainText('Plastic toy')
  await expect(page.getByLabel('Sale total')).toHaveText('₹ 105.00')
  await page.getByRole('button', { name: /^Charge/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'saved on this computer' })).toBeVisible()

  // the network returns: the app confirms who is signed in, and the sale uploads
  pipe = await open(port)
  await expect(page.getByText(/Working offline/)).toHaveCount(0, { timeout: 60_000 })
  await page.getByRole('button', { name: /Upload 1 offline sale/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Everything is uploaded' })).toBeVisible()
  await app.close(); pipe.close(); for (const sk of sockets) sk.destroy()
})

test('the shell is a complete desktop app: splash closes, window size is remembered, the menu and About are there', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'onesync-ud-'))
  let app = await launch(userData)
  let page = await appWindow(app)
  await expect(page.getByRole('heading', { name: 'Connect to your server' })).toBeVisible()
  // the start-up splash has gone: only the app window is left, and it carries the platform for the title-bar layout
  await expect.poll(() => app.windows().length).toBe(1)
  expect(await page.evaluate(() => document.documentElement.dataset['shell'])).toBe(process.platform)
  expect(await page.evaluate(() => window.onesync?.platform)).toBe(process.platform)
  // the entrance shows the brand panel on a wide window
  await expect(page.getByText('Your whole business, in one place.')).toBeVisible()
  // native menu with Help
  const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? [])
  expect(labels).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Help']))
  // the window size survives a restart
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ x: 60, y: 50, width: 1180, height: 760 }))
  await app.close()
  app = await launch(userData)
  page = await appWindow(app)
  await expect(page.getByRole('heading', { name: 'Connect to your server' })).toBeVisible()
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds())
  expect(b).toMatchObject({ width: 1180, height: 760 })
  // a log file is written for support
  const { existsSync } = await import('node:fs')
  expect(existsSync(join(userData, 'logs', 'main.log'))).toBe(true)
  await app.close()
})
