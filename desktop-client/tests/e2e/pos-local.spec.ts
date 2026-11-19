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

test('counter: items are found on this computer, with no request to the server, and still with no connection', async ({ page, context }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'loc' })
  const c = s.company.id
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as { id: string; code: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  await s.call('PUT', `/v1/pos/settings?companyId=${c}`, { walkInCustomerId: s.walkIn.id, cashVarianceAccountId: a('5900') })
  for (const [m, code] of [['cash', '1110'], ['upi', '1120'], ['card', '1120'], ['bank_transfer', '1120'], ['cheque', '1120'], ['other', '1120']]) await s.call('PUT', `/v1/pos/payment-accounts?companyId=${c}`, { method: m, accountId: a(code as string) })
  await s.call('POST', '/v1/pos/terminals', { companyId: c, code: 'T1', name: 'Counter 1', gstRegistrationId: s.registration.id, businessLocationId: s.location.id, warehouseId: s.warehouse.id })
  const nos = ((await s.call('GET', '/v1/units?limit=200')).items as { id: string; code: string }[]).find((u) => u.code === 'NOS') as { id: string }
  const list = await s.call('POST', '/v1/price-lists', { code: 'COUNTER', name: 'Counter prices', kind: 'sales', taxInclusive: true })
  const brush = await s.call('POST', '/v1/items', { code: 'BRUSH', name: 'Wide brush', baseUomId: nos.id, itemType: 'finished_good', taxCodeId: s.widget.taxCodeId, hsnSacCode: '9603' })
  for (const [item, price] of [[s.widget, '1180'], [s.cheap, '105'], [brush, '250']] as const) await s.call('POST', `/v1/price-lists/${list.id}/prices`, { itemId: item.id, uomId: nos.id, price, effectiveFrom: `${s.year}-04-01` })
  await s.call('POST', '/v1/stock/movements', { companyId: c, movementType: 'opening', postingDate: `${s.year}-04-01`, description: 'Opening', lines: [{ warehouseId: s.warehouse.id, itemId: brush.id, quantity: '50', unitCost: '100' }] })
  await signIn(page, s)

  await goTo(page, 'Counter')
  await page.getByLabel('Sell from price list').selectOption({ label: 'Counter prices (prices include tax)' })
  await page.getByLabel('Cash in the drawer').fill('500')
  await page.getByRole('button', { name: 'Open shift' }).click()
  const status = page.getByLabel('Item list status')
  await expect(status).toContainText(/3 items on this counter/) // the counter registered itself and downloaded its items once
  const scan = page.getByLabel(/Scan or type item/)

  // typing offers matches straight from this computer: not one request for items goes to the server
  const asked: string[] = []
  page.on('request', (r) => { if (/\/v1\/items/.test(r.url())) asked.push(r.url()) })
  await scan.fill('wid')
  const options = page.getByRole('listbox', { name: 'Matches' }).getByRole('option')
  await expect(options).toHaveCount(2)
  await expect(options.first()).toContainText('WIDGET') // best match first: a code that starts with it
  await expect(options.nth(1)).toContainText('BRUSH') // then a name with a word that starts with it
  await options.first().click()
  await expect(page.getByRole('table', { name: 'Cart' })).toContainText('Steel widget')
  await scan.fill('TOY'); await page.keyboard.press('Enter') // an exact code is added at once
  await expect(page.getByRole('table', { name: 'Cart' })).toContainText('Plastic toy')
  expect(asked).toEqual([])

  // a half-typed or cleared field must never take the screen down ("Not a valid amount:")
  for (const text of ['', 'abc', '.', '1e5', '-']) {
    await page.getByLabel('Discount of TOY').fill(text)
    await page.getByLabel('Quantity of TOY').fill(text).catch(() => undefined)
    await expect(page.getByText('This screen ran into a problem')).toHaveCount(0)
    await expect(page.getByLabel(/Scan or type item/)).toBeVisible()
  }
  await page.getByLabel('Discount of TOY').fill('0'); await page.getByLabel('Quantity of TOY').fill('1')

  // the connection drops: finding items works the same, and a sale is kept on this computer
  await context.setOffline(true)
  await scan.fill('brush'); await page.keyboard.press('Enter')
  await expect(page.getByRole('table', { name: 'Cart' })).toContainText('Wide brush')
  await expect(page.getByLabel('Sale total')).toHaveText('₹ 1,535.00') // 1180 + 105 + 250, worked out on this computer
  await scan.fill('nothing-like-this'); await page.keyboard.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: /not on this counter's item list/ })).toBeVisible()
  await context.setOffline(false)
})
