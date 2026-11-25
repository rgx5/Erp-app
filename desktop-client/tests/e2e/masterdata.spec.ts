import { expect, test, type Page } from '@playwright/test'
import { goTo } from '../nav'
import { gstinCheckCharacter } from '../../src/domain/india'

const PASSWORD = 'a long passphrase for tests 42'
const gstin = (state: string, pan: string): string => { const f = `${state}${pan}1Z`; return f + gstinCheckCharacter(f) }

async function seed() {
  const base = process.env['E2E_BACKEND_URL'] as string
  const slug = `md-${Date.now().toString(36)}`
  const email = `owner@${slug}.example.com`
  const json = { 'content-type': 'application/json' }
  const post = async (path: string, body: unknown, token?: string) => { const r = await fetch(`${base}${path}`, { method: 'POST', headers: { ...json, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); return (await r.json()) as { id: string; accessToken?: string } }
  await fetch(`${base}/v1/platform/tenants`, { method: 'POST', headers: { ...json, authorization: `Bearer ${process.env['E2E_PLATFORM_TOKEN']}` }, body: JSON.stringify({ name: 'MD Co', slug, owner: { email, displayName: 'MD Owner', password: PASSWORD } }) })
  const token = ((await post('/v1/auth/login', { tenant: slug, email, password: PASSWORD })).accessToken) as string
  const company = await post('/v1/companies', { legalName: 'Master Data Pvt Ltd' }, token)
  await post(`/v1/companies/${company.id}/gst-registrations`, { gstin: gstin('27', 'ABCDE1234F'), legalName: 'Master Data Pvt Ltd', effectiveFrom: '2025-04-01' }, token)
  await post('/v1/fiscal-years', { companyId: company.id, startDate: '2025-04-01' }, token)
  await post(`/v1/companies/${company.id}/setup/apply-defaults`, {}, token)
  return { base, slug, email }
}

async function signIn(page: Page, s: { base: string; slug: string; email: string }) {
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug)
  await page.getByLabel('Email').fill(s.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('master data: items, customers, tax rates and price lists from the app', async ({ page }) => {
  const s = await seed()
  await signIn(page, s)

  // ---- items ----
  await goTo(page, 'Items')
  await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible()
  await page.getByRole('button', { name: 'New item' }).click()
  const drawer = page.getByRole('dialog', { name: 'New item' })
  await drawer.getByLabel('Code', { exact: true }).fill('SHIRT-M')
  await drawer.getByLabel('Name', { exact: true }).fill('Cotton shirt (M)')
  await drawer.getByLabel('Unit').selectOption({ label: 'Numbers (NOS)' })
  await drawer.getByLabel('HSN').fill('62')
  await drawer.getByRole('button', { name: 'Create item' }).click()
  await expect(drawer.getByText('An HSN is 4, 6 or 8 digits')).toBeVisible() // caught on the page
  await drawer.getByLabel('HSN').fill('6205')
  await drawer.getByLabel('GST tax code').selectOption({ label: 'GST12 · GST 12%' })
  await drawer.getByRole('button', { name: 'Create item' }).click()
  await expect(page.getByRole('cell', { name: 'SHIRT-M' })).toBeVisible()

  // a duplicate code is explained by the server, next to nothing wrong in the form itself
  await page.getByRole('button', { name: 'New item' }).click()
  const again = page.getByRole('dialog', { name: 'New item' })
  await again.getByLabel('Code', { exact: true }).fill('SHIRT-M')
  await again.getByLabel('Name', { exact: true }).fill('Duplicate')
  await again.getByLabel('Unit').selectOption({ label: 'Numbers (NOS)' })
  await again.getByRole('button', { name: 'Create item' }).click()
  await expect(again.getByRole('alert')).toBeVisible()
  await page.keyboard.press('Escape')

  // import: one good row and one bad row
  await goTo(page, 'Import data')
  await page.getByRole('button', { name: /Import items/ }).click()
  const csv = 'Code,Name,Type,Unit,HSN/SAC,GST code,Sellable,Purchasable\nTROUSER-32,Cotton trouser,finished_good,NOS,6203,GST12,yes,yes\nBAD-1,Broken row,finished_good,NOS,12,GST12,yes,yes\n'
  await page.getByLabel('Data file').setInputFiles({ name: 'items.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('status').filter({ hasText: '2 rows' })).toContainText('1 ready')
  await expect(page.getByText('An HSN is 4, 6 or 8 digits').last()).toBeVisible()
  await page.getByRole('button', { name: 'Import 1 rows' }).click()
  await expect(page.getByRole('status').filter({ hasText: '2 rows' })).toContainText('1 created')
  await page.getByRole('button', { name: 'Done' }).click()
  await goTo(page, 'Items')
  await expect(page.getByRole('cell', { name: 'TROUSER-32' })).toBeVisible()

  // search and edit
  await page.getByLabel('Search').fill('trouser')
  await expect(page.getByRole('cell', { name: 'SHIRT-M' })).toHaveCount(0)
  await page.getByRole('cell', { name: 'TROUSER-32' }).click()
  const edit = page.getByRole('dialog', { name: 'Cotton trouser' })
  await expect(edit.getByLabel('Code', { exact: true })).toBeDisabled()
  await edit.getByLabel('Name', { exact: true }).fill('Cotton trouser (slim)')
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('cell', { name: 'Cotton trouser (slim)' })).toBeVisible()

  // export lives in the Data section and saves every item
  await goTo(page, 'Export data')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Items' }).click()])
  expect(download.suggestedFilename()).toBe('items.csv')
  const exported = (await (await import('node:fs/promises')).readFile((await download.path()) as string, 'utf8'))
  expect(exported).toContain('TROUSER-32')
  expect(exported).toContain('SHIRT-M')
  await goTo(page, 'Items')

  // ---- customers ----
  await goTo(page, 'Customers')
  await page.getByRole('button', { name: 'New customer' }).click()
  const cust = page.getByRole('dialog', { name: 'New customer' })
  await cust.getByLabel('Code', { exact: true }).fill('C-001')
  await cust.getByLabel('Legal name').fill('Asha Traders')
  await cust.getByLabel('GSTIN').fill('27ABCDE1234F1Z9')
  await cust.getByRole('button', { name: 'Create party' }).click()
  await expect(cust.getByText('This GSTIN is not valid')).toBeVisible()
  await cust.getByLabel('GSTIN').fill(gstin('29', 'KLMNO9012P'))
  await expect(cust.getByText('State Karnataka · PAN KLMNO9012P')).toBeVisible()
  await cust.getByRole('button', { name: 'Create party' }).click()
  await expect(page.getByRole('cell', { name: 'Asha Traders' })).toBeVisible()
  await page.getByRole('cell', { name: 'Asha Traders' }).click()
  await expect(page.getByRole('heading', { name: /Asha Traders/ })).toBeVisible() // opens the customer's own page
  await page.getByRole('button', { name: 'Edit details' }).click()
  const open = page.getByRole('dialog', { name: 'Asha Traders' })
  await open.getByRole('button', { name: 'Add address' }).click()
  await open.getByLabel('Address', { exact: true }).fill('5 MG Road')
  await open.getByLabel('City', { exact: true }).fill('Bengaluru')
  await open.getByLabel('Pincode').fill('560001')
  await open.getByRole('button', { name: 'Save address' }).click()
  await expect(open.getByText('5 MG Road, Bengaluru, Karnataka, 560001')).toBeVisible()
  await page.keyboard.press('Escape')

  // ---- tax rates ----
  await goTo(page, 'Tax codes')
  await page.getByRole('cell', { name: 'GST12', exact: true }).click()
  const tax = page.getByRole('dialog', { name: 'GST12' })
  await expect(tax.getByText('12%').first()).toBeVisible()
  await tax.getByLabel('Applies from').fill('2026-04-01')
  await tax.getByLabel('GST rate (IGST %)').fill('18')
  await tax.getByRole('button', { name: 'Add rate' }).click()
  await expect(tax.getByRole('cell', { name: '18%' }).first()).toBeVisible()
  await page.keyboard.press('Escape')

  // ---- price lists ----
  await goTo(page, 'Price lists')
  await page.getByRole('button', { name: 'New price list' }).click()
  const pl = page.getByRole('dialog', { name: 'New price list' })
  await pl.getByLabel('Code', { exact: true }).fill('RETAIL')
  await pl.getByLabel('Name', { exact: true }).fill('Retail prices')
  await pl.getByRole('button', { name: 'Create price list' }).click()
  await page.getByRole('cell', { name: 'Retail prices' }).click()
  const prices = page.getByRole('dialog', { name: 'Retail prices' })
  await prices.getByLabel('Item', { exact: true }).fill('trouser')
  await prices.getByRole('option', { name: /TROUSER-32/ }).click()
  await prices.getByLabel('Price', { exact: true }).fill('1499.50')
  await prices.getByRole('button', { name: 'Add price' }).click()
  await expect(prices.getByRole('cell', { name: '₹ 1,499.50' })).toBeVisible()
  await expect(prices.getByRole('cell', { name: /TROUSER-32/ })).toBeVisible()
})
