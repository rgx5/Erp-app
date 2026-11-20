import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('gift cards: sell one at the counter, then pay part of a bill with its code', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'gc' })
  const c = s.company.id
  const accts = (await s.call('GET', `/v1/accounts?companyId=${c}&limit=200`)).items as unknown as { id: string; code: string }[]
  const a = (code: string) => (accts.find((x) => x.code === code) as { id: string }).id
  await s.call('PUT', `/v1/pos/settings?companyId=${c}`, { walkInCustomerId: s.walkIn.id, cashVarianceAccountId: a('5900') })
  for (const [m, code] of [['cash', '1110'], ['upi', '1120'], ['card', '1120'], ['gift_card', '2145']]) await s.call('PUT', `/v1/pos/payment-accounts?companyId=${c}`, { method: m, accountId: a(code) })
  const term = await s.call('POST', '/v1/pos/terminals', { companyId: c, code: 'T1', name: 'Counter 1', gstRegistrationId: s.registration.id, businessLocationId: s.location.id, warehouseId: s.warehouse.id })
  const tee = await s.call('POST', '/v1/items', { code: 'TEE', name: 'Cotton tee', baseUomId: s.widget.baseUomId, itemType: 'finished_good', taxCodeId: s.widget.taxCodeId, hsnSacCode: '6109', mrp: '118' })
  await s.call('POST', '/v1/stock/movements', { companyId: c, movementType: 'opening', postingDate: `${s.year}-04-01`, description: 'Opening', lines: [{ warehouseId: s.warehouse.id, itemId: tee.id, quantity: '10', unitCost: '50' }] })
  await s.call('POST', '/v1/pos/shifts', { terminalId: term.id, openingCash: '500' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await goTo(page, 'Counter')

  await page.getByRole('button', { name: 'Sell gift card' }).click()
  const d = page.getByRole('dialog', { name: 'Sell a gift card' })
  await d.getByLabel('Amount').fill('500')
  await d.getByRole('button', { name: 'Sell gift card' }).click()
  await expect(d.getByText(/Sold\. Code/)).toBeVisible()
  const code = (await d.getByText(/GC-[A-Z0-9]{4}-/).first().innerText()).match(/GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0] as string
  expect(code).toBeTruthy()
  await page.keyboard.press('Escape')

  await page.getByLabel(/Scan or type item/).fill('TEE'); await page.keyboard.press('Enter')
  await expect(page.getByRole('table', { name: 'Cart' })).toContainText('Cotton tee')
  await page.getByLabel('Method').first().selectOption('gift_card')
  await page.getByLabel('Gift card code').fill(code)
  const charge = page.getByRole('button', { name: /^Charge/ })
  await expect(charge).toBeEnabled()
  await charge.click()
  await expect(page.getByLabel('Last sale')).toContainText('INV/')
  const card = (await s.call('GET', `/v1/pos/gift-cards/${code}?companyId=${c}`)) as unknown as { balance: string }
  expect(Number(card.balance)).toBeLessThan(500)
})
