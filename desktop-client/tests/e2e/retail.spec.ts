import { expect, test, type Page } from '@playwright/test'
import { goTo } from '../nav'
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
  await goTo(page, 'Categories')
  await page.getByRole('button', { name: 'New category' }).click()
  const cat = page.getByRole('dialog', { name: 'New category' })
  await cat.getByLabel('Code', { exact: true }).fill('LIQ'); await cat.getByLabel('Name').fill('Liquor')
  await cat.getByLabel('No discount on items in this category').check()
  await cat.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('table', { name: 'Categories' })).toContainText('Not allowed')

  // ---- an item in it, with a brand, an MRP and a barcode ----
  await goTo(page, 'Items')
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
  await goTo(page, 'Counter')
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

test('expenses: a category, a voucher paid from cash, and cancelling it', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'exp' })
  await signIn(page, s)
  await goTo(page, 'Expenses')
  await page.getByRole('tab', { name: 'Categories' }).click()
  await page.getByRole('button', { name: 'New category' }).click()
  const cat = page.getByRole('dialog', { name: 'New expense category' })
  await cat.getByLabel('Code', { exact: true }).fill('TEA'); await cat.getByLabel('Name', { exact: true }).fill('Tea and snacks')
  await cat.getByLabel('Books to (expense account)').fill('5900')
  await cat.getByRole('listbox').getByRole('option', { name: /5900/ }).click()
  await cat.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('table', { name: 'Expense categories' })).toContainText('Tea and snacks')
  await page.getByRole('tab', { name: 'Expenses', exact: true }).click()
  await page.getByRole('button', { name: 'New expense' }).click()
  const v = page.getByRole('dialog', { name: 'New expense' })
  await v.getByLabel('Amount').fill('250')
  await v.getByLabel('Paid from (cash or bank)').fill('1110')
  await v.getByRole('listbox').getByRole('option', { name: /1110/ }).click()
  await v.getByLabel('Paid to (optional)').fill('Raju tea stall')
  await v.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'EXP/' })).toBeVisible()
  await expect(page.getByLabel('Total spent')).toContainText('250.00')
  await page.getByRole('cell', { name: /EXP\// }).click()
  await page.getByRole('dialog').getByLabel('Reason to cancel').fill('Entered twice')
  await page.getByRole('button', { name: 'Cancel expense' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'cancelled' })).toBeVisible()
  await expect(page.getByLabel('Total spent')).toContainText('0.00')
})

test('customer wallet: loyalty rates and a coupon, a coupon sale, a return kept as store credit, then paying with that credit', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'wal' })
  const c = s.company.id
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as { id: string; code: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  await s.call('PUT', `/v1/pos/settings?companyId=${c}`, { walkInCustomerId: s.walkIn.id, cashVarianceAccountId: a('5900') })
  for (const [m, code] of [['cash', '1110'], ['upi', '1120'], ['card', '1120'], ['bank_transfer', '1120'], ['cheque', '1120'], ['other', '1120']]) await s.call('PUT', `/v1/pos/payment-accounts?companyId=${c}`, { method: m, accountId: a(code as string) })
  await s.call('POST', '/v1/pos/terminals', { companyId: c, code: 'T1', name: 'Counter 1', gstRegistrationId: s.registration.id, businessLocationId: s.location.id, warehouseId: s.warehouse.id })
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const list = await s.call('POST', '/v1/price-lists', { code: 'COUNTER', name: 'Counter prices', kind: 'sales', taxInclusive: true })
  await s.call('POST', `/v1/price-lists/${list.id}/prices`, { itemId: s.widget.id, uomId: nos.id, price: '1180', effectiveFrom: `${s.year}-04-01` })
  await signIn(page, s)

  // ---- loyalty rates and a coupon ----
  await goTo(page, 'Loyalty and coupons')
  await page.getByLabel('Points earned per ₹100 spent').fill('1')
  await page.getByLabel('Value of one point (₹)').fill('0.5')
  await page.getByRole('button', { name: 'Save rates' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Loyalty rates saved' })).toBeVisible()
  await page.getByRole('button', { name: 'New coupon' }).click()
  const cp = page.getByRole('dialog', { name: 'New coupon' })
  await cp.getByLabel('Code the cashier types').fill('SAVE10'); await cp.getByLabel('Value (% or ₹)').fill('10'); await cp.getByLabel('Minimum bill (optional)').fill('500')
  await cp.getByRole('button', { name: 'Create coupon' }).click()
  await expect(page.getByRole('table', { name: 'Coupons' })).toContainText('10% off over')

  // ---- a sale with the coupon, to a named customer ----
  await goTo(page, 'Counter')
  await page.getByLabel('Sell from price list').selectOption({ label: 'Counter prices (prices include tax)' })
  await page.getByLabel('Cash in the drawer').fill('0')
  await page.getByRole('button', { name: 'Open shift' }).click()
  await scan(page, 'WIDGET')
  await expect(page.getByLabel('Sale total')).toHaveText('₹ 1,180.00')
  await page.getByRole('textbox', { name: 'Customer (for credit, points and coupons)' }).fill('Asha')
  await page.getByRole('option', { name: /Asha Traders/ }).click()
  await page.getByLabel('Coupon code').fill('SAVE10')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Coupon SAVE10 takes' })).toBeVisible()
  await expect(page.getByLabel('Sale total')).toHaveText('₹ 1,062.00')
  await page.getByRole('button', { name: /^Charge/ }).click()
  await expect(page.getByLabel('Last sale')).toContainText('INV/')

  // ---- the return is kept as store credit ----
  await page.getByRole('button', { name: 'Return', exact: true }).click()
  const ret = page.getByRole('dialog', { name: 'Return goods' })
  await ret.getByRole('button', { name: /INV\// }).click()
  await ret.getByLabel('Return Steel widget').fill('1')
  await ret.getByLabel('Reason').fill('Changed mind')
  await ret.getByLabel('Refund by').selectOption('store_credit')
  await ret.getByRole('button', { name: 'Record return and refund' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'kept as store credit' })).toBeVisible()

  // ---- the next sale uses that credit ----
  await scan(page, 'WIDGET')
  await page.getByRole('textbox', { name: 'Customer (for credit, points and coupons)' }).fill('Asha')
  await page.getByRole('option', { name: /Asha Traders/ }).click()
  await expect(page.getByLabel('Wallet balance')).toContainText('₹ 1,062.00')
  await page.getByLabel('Use store credit').check()
  await expect(page.getByLabel('Store credit used')).toHaveText('₹ 1,062.00')
  await page.getByRole('button', { name: /^Charge/ }).click()
  await expect(page.getByLabel('Last sale')).toContainText('INV/2627/00002')
  await page.getByRole('textbox', { name: 'Customer (for credit, points and coupons)' }).fill('Asha')
  await page.getByRole('option', { name: /Asha Traders/ }).click()
  await expect(page.getByLabel('Wallet balance')).toContainText('Store credit₹ 0.00')
})

test('counter: hold a bill while serving someone else, recall it, and share the receipt on WhatsApp', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'hld' })
  const c = s.company.id
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as { id: string; code: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  await s.call('PUT', `/v1/pos/settings?companyId=${c}`, { walkInCustomerId: s.walkIn.id, cashVarianceAccountId: a('5900') })
  for (const [m, code] of [['cash', '1110'], ['upi', '1120'], ['card', '1120'], ['bank_transfer', '1120'], ['cheque', '1120'], ['other', '1120']]) await s.call('PUT', `/v1/pos/payment-accounts?companyId=${c}`, { method: m, accountId: a(code as string) })
  await s.call('POST', '/v1/pos/terminals', { companyId: c, code: 'T1', name: 'Counter 1', gstRegistrationId: s.registration.id, businessLocationId: s.location.id, warehouseId: s.warehouse.id })
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const list = await s.call('POST', '/v1/price-lists', { code: 'COUNTER', name: 'Counter prices', kind: 'sales', taxInclusive: true })
  await s.call('POST', `/v1/price-lists/${list.id}/prices`, { itemId: s.widget.id, uomId: nos.id, price: '1180', effectiveFrom: `${s.year}-04-01` })
  await s.call('POST', `/v1/price-lists/${list.id}/prices`, { itemId: s.cheap.id, uomId: nos.id, price: '105', effectiveFrom: `${s.year}-04-01` })
  await signIn(page, s)
  await goTo(page, 'Counter')
  await page.getByLabel('Sell from price list').selectOption({ label: 'Counter prices (prices include tax)' })
  await page.getByLabel('Cash in the drawer').fill('0')
  await page.getByRole('button', { name: 'Open shift' }).click()

  await scan(page, 'WIDGET')
  await page.getByRole('button', { name: 'Hold bill' }).click()
  await expect(page.getByRole('table', { name: 'Cart' })).toContainText('Scan an item to begin')
  await expect(page.getByRole('button', { name: 'Held bills (1)' })).toBeVisible()
  await scan(page, 'TOY')
  await expect(page.getByLabel('Sale total')).toHaveText('₹ 105.00')
  await page.getByRole('button', { name: /^Charge/ }).click()
  await expect(page.getByLabel('Last sale')).toContainText('INV/')
  await page.getByLabel('Customer mobile for WhatsApp').fill('98765 43210')
  await page.evaluate(() => { (window as unknown as { open: (u: string) => null }).open = (u: string) => { (window as unknown as { __opened: string }).__opened = u; return null } })
  await page.getByRole('button', { name: 'Send on WhatsApp' }).click()
  expect(await page.evaluate(() => (window as unknown as { __opened: string }).__opened)).toContain('wa.me/919876543210?text=')

  await page.getByRole('button', { name: 'Held bills (1)' }).click()
  await page.getByRole('button', { name: 'Recall' }).click()
  await expect(page.getByRole('table', { name: 'Cart' })).toContainText('WIDGET')
  await expect(page.getByLabel('Sale total')).toHaveText('₹ 1,180.00')
  await expect(page.getByRole('button', { name: 'Held bills (0)' })).toBeVisible()
})

test('layout: the sidebar is the default, and the command centre can be chosen in My account and kept', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'lay' })
  await signIn(page, s)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Invoices' })).toBeVisible() // the sidebar lists pages directly
  await page.getByRole('link', { name: 'My account' }).click()
  await page.getByLabel(/Command centre/).check()
  await expect(page.getByRole('navigation', { name: 'Admin pages' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Admin pages' })).toBeVisible() // remembered
  await goTo(page, 'Items')
  await page.getByRole('button', { name: 'New item' }).click()
  await expect(page.getByRole('complementary', { name: 'Record' }).getByRole('dialog', { name: 'New item' })).toBeVisible() // docked beside the list
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'My account' }).click()
  await page.getByLabel(/^Sidebar/).check()
  await expect(page.getByRole('navigation', { name: 'Admin pages' })).toHaveCount(0)
})

test('counter staff: a discount above the limit needs a manager PIN, and a line is credited to a salesperson', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'stf' })
  const c = s.company.id
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as { id: string; code: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  await s.call('PUT', `/v1/pos/settings?companyId=${c}`, { walkInCustomerId: s.walkIn.id, cashVarianceAccountId: a('5900') })
  for (const [m, code] of [['cash', '1110'], ['upi', '1120'], ['card', '1120'], ['bank_transfer', '1120'], ['cheque', '1120'], ['other', '1120']]) await s.call('PUT', `/v1/pos/payment-accounts?companyId=${c}`, { method: m, accountId: a(code as string) })
  await s.call('POST', '/v1/pos/terminals', { companyId: c, code: 'T1', name: 'Counter 1', gstRegistrationId: s.registration.id, businessLocationId: s.location.id, warehouseId: s.warehouse.id })
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const list = await s.call('POST', '/v1/price-lists', { code: 'COUNTER', name: 'Counter prices', kind: 'sales', taxInclusive: true })
  await s.call('POST', `/v1/price-lists/${list.id}/prices`, { itemId: s.widget.id, uomId: nos.id, price: '1000', effectiveFrom: `${s.year}-04-01` })
  await s.call('PUT', '/v1/pos/me/pin', { pin: '4321' })
  await s.call('PUT', `/v1/retail/settings?companyId=${c}`, { maxDiscountWithoutApproval: '10' })
  await signIn(page, s)
  await goTo(page, 'Counter')
  await page.getByLabel('Sell from price list').selectOption({ label: 'Counter prices (prices include tax)' })
  await page.getByLabel('Cash in the drawer').fill('0')
  await page.getByRole('button', { name: 'Open shift' }).click()
  await scan(page, 'WIDGET')
  await expect(page.getByLabel('Sold by WIDGET')).toHaveValue(/.+/) // the cashier by default
  await page.getByLabel('Discount of WIDGET').fill('20')
  await expect(page.getByLabel('Sale total')).toHaveText('₹ 800.00')
  await page.getByRole('button', { name: /^Charge/ }).click()
  const box = page.getByLabel('Manager approval')
  await expect(box).toContainText('above 10%')
  await box.getByLabel('Approved by').selectOption({ label: 'Seed Owner' })
  await box.getByLabel('Manager PIN').fill('0000')
  await box.getByRole('button', { name: 'Approve and charge' }).click()
  await expect(page.getByRole('alert')).toContainText('PIN')
  await box.getByLabel('Manager PIN').fill('4321')
  await box.getByRole('button', { name: 'Approve and charge' }).click()
  await expect(page.getByLabel('Last sale')).toContainText('INV/')
})

test('industry template: categories for a kind of shop in one step, then filtering items by category', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'tpl' })
  await signIn(page, s)
  await goTo(page, 'Categories')
  await page.getByRole('button', { name: 'Start from a template' }).click()
  const d = page.getByRole('dialog', { name: 'Start from a template' })
  await d.getByLabel('Kind of shop').selectOption({ label: 'Grocery and kirana' })
  await expect(d.getByLabel('Categories in this template')).toContainText('Staples')
  await d.getByRole('button', { name: 'Create these categories' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'categories created' })).toBeVisible()
  const table = page.getByRole('table', { name: 'Categories' })
  await expect(table).toContainText('Staples'); await expect(table).toContainText('Rice and grains')
  // running it again creates nothing new
  await page.getByRole('button', { name: 'Start from a template' }).click()
  await page.getByRole('dialog', { name: 'Start from a template' }).getByRole('button', { name: 'Create these categories' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'already exist' })).toBeVisible()

  // items carry a category, shown and filterable on the items list
  const cats = (await s.call('GET', '/v1/item-categories?limit=200')).items as { id: string; name: string }[]
  const rice = cats.find((c) => c.name === 'Rice and grains') as { id: string }
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  await s.call('POST', '/v1/items', { code: 'BASMATI', name: 'Basmati rice 5kg', baseUomId: nos.id, itemType: 'finished_good', taxCodeId: s.widget.taxCodeId, hsnSacCode: '1006', categoryId: rice.id, brand: 'Daawat', mrp: '620' })
  await goTo(page, 'Items')
  await expect(page.getByRole('cell', { name: 'BASMATI', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'WIDGET', exact: true })).toBeVisible()
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Rice and grains' })
  await expect(page.getByRole('cell', { name: 'WIDGET', exact: true })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'BASMATI', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Daawat', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '620.00' })).toBeVisible()
})
