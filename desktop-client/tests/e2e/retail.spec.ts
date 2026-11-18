import { expect, test, type Page } from '@playwright/test'
import { seedBusiness } from '../seed'

async function signIn(page: Page, s: { base: string; slug: string; email: string; password: string }) {
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug)
  await page.getByLabel('Email').fill(s.email)
  await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}
const scan = async (page: Page, code: string) => { await page.getByLabel(/Scan or type item/).fill(code); await page.keyboard.press('Enter') }

test('retail catalogue: a no-discount category, an item with MRP and a barcode, sold by scanning the barcode', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'rtl' })
  const c = s.company.id
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as { id: string; code: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  await s.call('PUT', `/v1/pos/settings?companyId=${c}`, { walkInCustomerId: s.walkIn.id, cashVarianceAccountId: a('5900') })
  for (const [m, code] of [['cash', '1110'], ['upi', '1120'], ['card', '1120'], ['bank_transfer', '1120'], ['cheque', '1120'], ['other', '1120']]) await s.call('PUT', `/v1/pos/payment-accounts?companyId=${c}`, { method: m, accountId: a(code as string) })
  await s.call('POST', '/v1/pos/terminals', { companyId: c, code: 'T1', name: 'Counter 1', gstRegistrationId: s.registration.id, businessLocationId: s.location.id, warehouseId: s.warehouse.id })
  await signIn(page, s)

  // ---- a category that forbids discounts ----
  await page.getByRole('link', { name: 'Categories' }).click()
  await page.getByRole('button', { name: 'New category' }).click()
  const cat = page.getByRole('dialog', { name: 'New category' })
  await cat.getByLabel('Code', { exact: true }).fill('LIQ'); await cat.getByLabel('Name').fill('Liquor')
  await cat.getByLabel('No discount on items in this category').check()
  await cat.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('table', { name: 'Categories' })).toContainText('Not allowed')

  // ---- an item in it, with a brand, an MRP and a barcode ----
  await page.getByRole('link', { name: 'Items', exact: true }).click()
  await page.getByRole('button', { name: 'New item' }).click()
  const item = page.getByRole('dialog', { name: 'New item' })
  await item.getByLabel('Code', { exact: true }).fill('WHISKY1'); await item.getByLabel('Name', { exact: true }).fill('Royal whisky 750ml')
  await item.getByLabel('Unit').selectOption({ label: 'Numbers (NOS)' }).catch(async () => { await item.getByLabel('Unit').selectOption({ index: 1 }) })
  await item.getByLabel('Category').selectOption({ label: 'Liquor' })
  await item.getByLabel('Brand (optional)').fill('Royal'); await item.getByLabel('MRP (optional)').fill('1180')
  await item.getByLabel('Type').selectOption('trading_good')
  await item.getByLabel('GST tax code').selectOption({ index: 1 })
  await item.getByRole('button', { name: 'Create item' }).click()
  await page.getByRole('cell', { name: 'WHISKY1' }).click()
  const edit = page.getByRole('dialog', { name: 'Royal whisky 750ml' })
  await edit.getByLabel('Add a barcode').fill('8901111000012')
  await edit.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(edit.getByRole('region', { name: 'Barcodes' })).toContainText('8901111000012')
  await page.keyboard.press('Escape')
  await s.call('POST', '/v1/stock/movements', { companyId: c, movementType: 'opening', postingDate: `${s.year}-04-01`, description: 'Opening', lines: [{ warehouseId: s.warehouse.id, itemId: ((await s.call('GET', '/v1/items/lookup?code=WHISKY1')) as unknown as { item: { id: string } }).item.id, quantity: '10', unitCost: '600' }] })

  // ---- the counter: scanning the barcode finds it, prices it at MRP, and refuses a discount ----
  await page.getByRole('link', { name: 'Counter', exact: true }).click()
  await page.getByLabel('Cash in the drawer').fill('0')
  await page.getByRole('button', { name: 'Open shift' }).click()
  await expect(page.getByLabel(/Scan or type item/)).toBeVisible()
  await scan(page, '8901111000012')
  await expect(page.getByRole('table', { name: 'Cart' })).toContainText('WHISKY1')
  await expect(page.getByLabel('Price of WHISKY1')).toHaveValue('1180')
  await expect(page.getByLabel('Discount of WHISKY1')).toBeDisabled()
  await expect(page.getByLabel('Sale total')).toHaveText('₹ 1,180.00')
  await page.getByRole('button', { name: /^Charge/ }).click()
  await expect(page.getByRole('table', { name: 'Cart' })).toContainText('Scan an item to begin')
})
