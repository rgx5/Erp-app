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

test('point of sale: open a shift, sell, return, sell offline and upload, cash up', async ({ page, context }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'pos' })
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

  // ---- this computer becomes a device for offline selling ----
  await page.getByRole('link', { name: 'Shifts and setup' }).click()
  await page.getByRole('tab', { name: 'Setup' }).click()
  await page.getByRole('button', { name: /Register this computer for T1|Use this computer for offline selling/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'sell offline' })).toBeVisible()

  // ---- open the shift ----
  await page.getByRole('link', { name: 'Counter', exact: true }).click()
  await page.getByLabel('Sell from price list').selectOption({ label: 'Counter prices (prices include tax)' })
  await page.getByLabel('Cash in the drawer').fill('500')
  await page.getByRole('button', { name: 'Open shift' }).click()
  await expect(page.getByRole('status').filter({ hasText: /items saved for selling offline|SHF\// })).toBeVisible()
  await expect(page.getByLabel(/Scan or type item/)).toBeVisible()

  // ---- a sale: two widgets and a toy at 10% off; the total is the server's, rounded ----
  await scan(page, 'WIDGET'); await scan(page, 'WIDGET'); await scan(page, 'TOY')
  await page.getByLabel('Discount of TOY').fill('10')
  await expect(page.getByLabel('Sale total')).toHaveText('₹ 2,455.00')
  await page.getByLabel('Cash given').fill('3000')
  await expect(page.getByLabel('Change due')).toHaveText('₹ 545.00')
  await page.getByRole('button', { name: /^Charge/ }).click()
  await expect(page.getByLabel('Last sale')).toContainText('INV/')
  await expect(page.getByRole('table', { name: 'Cart' })).toContainText('Scan an item to begin')

  // ---- a return of the toy ----
  await page.getByRole('button', { name: 'Return', exact: true }).click()
  const ret = page.getByRole('dialog', { name: 'Return goods' })
  await ret.getByRole('button', { name: /INV\// }).click()
  await ret.getByLabel('Return Plastic toy').fill('1')
  await ret.getByLabel('Reason').fill('Wrong colour')
  await ret.getByRole('button', { name: 'Record return and refund' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'CN/' })).toBeVisible()

  // ---- the connection drops: a sale is kept on this computer, then uploaded ----
  await context.setOffline(true)
  await scan(page, 'TOY')
  await expect(page.getByLabel('Sale total')).toHaveText('₹ 105.00')
  await page.getByRole('button', { name: /^Charge/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'saved on this computer' })).toBeVisible()
  await context.setOffline(false)
  await page.getByRole('button', { name: /Upload 1 offline sale/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Everything is uploaded' })).toBeVisible()

  // ---- cash up ----
  await page.getByRole('button', { name: 'Close shift' }).click()
  const close = page.getByRole('dialog', { name: /^Close SHF/ })
  await expect(close.getByLabel('Shift summary')).toContainText('Sales (2)')
  await close.getByLabel('Cash counted in the drawer').fill('3470')
  await close.getByRole('button', { name: 'Close shift' }).click()
  await expect(close.getByLabel('Cash-up result')).toContainText('Closed')
})
