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

test('inventory: stock on hand, an adjustment, a transfer, a count, and valuation that agrees with the books', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'inv' })
  await s.call('POST', '/v1/warehouses', { businessLocationId: s.location.id, code: 'STORE2', name: 'Second store', kind: 'general' })
  await signIn(page, s)

  // ---- stock on hand and a stock card ----
  await goTo(page, 'Stock on hand')
  await expect(page.getByRole('heading', { name: 'Stock on hand' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'WIDGET · Steel widget' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('₹ 80,000.00')
  await page.getByRole('cell', { name: 'WIDGET · Steel widget' }).click()
  const card = page.getByRole('dialog', { name: /WIDGET/ })
  await expect(card.getByText('Opening stock')).toBeVisible()
  await page.keyboard.press('Escape')

  // ---- take out damaged stock, put in found stock ----
  await page.getByRole('button', { name: 'Adjust stock' }).click()
  const adj = page.getByRole('dialog', { name: 'Adjust stock' })
  await adj.getByLabel('Reason').fill('Damaged in the godown')
  await adj.getByLabel('Item', { exact: true }).fill('wid')
  await adj.getByRole('option', { name: /WIDGET/ }).click()
  await adj.getByLabel('Quantity').fill('3')
  await adj.getByRole('button', { name: 'Post adjustment' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'SA/' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '97', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'total value' })).toContainText('₹ 78,800.00')

  await page.getByRole('button', { name: 'Adjust stock' }).click()
  const found = page.getByRole('dialog', { name: 'Adjust stock' })
  await found.getByLabel('Reason').fill('Found in the back room')
  await found.getByLabel('Item', { exact: true }).fill('toy')
  await found.getByRole('option', { name: /TOY/ }).click()
  await found.getByLabel('Direction').selectOption('in')
  await found.getByLabel('Quantity').fill('5')
  await found.getByLabel('Cost each').fill('400')
  await found.getByRole('button', { name: 'Post adjustment' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'total value' })).toContainText('₹ 80,800.00')

  // ---- a transfer to the second store ----
  await goTo(page, 'Transfers')
  await page.getByRole('button', { name: 'New transfer' }).click()
  const tr = page.getByRole('dialog', { name: 'New stock transfer' })
  await tr.getByLabel('Note').fill('Stock the second store')
  await tr.getByLabel('Item', { exact: true }).fill('wid')
  await tr.getByRole('option', { name: /WIDGET/ }).click()
  await tr.getByLabel('Quantity').fill('5')
  await tr.getByRole('button', { name: 'Transfer stock' }).click()
  await expect(page.getByRole('cell', { name: /TF\/\d{4}\/000001/ })).toBeVisible()
  await goTo(page, 'Stock on hand')
  await page.getByLabel('Warehouse').selectOption({ label: 'Second store' })
  await expect(page.getByRole('cell', { name: 'WIDGET · Steel widget' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '5', exact: true })).toBeVisible()

  // ---- a count finds two missing ----
  await goTo(page, 'Stock counts')
  await page.getByRole('button', { name: 'New count' }).click()
  const start = page.getByRole('dialog', { name: 'Start a stock count' })
  await start.getByLabel('Description').fill('November cycle count')
  await start.getByRole('button', { name: 'Start counting' }).click()
  const sheet = page.getByRole('dialog', { name: /CN\/\d{4}\/000001/ })
  await expect(sheet.getByRole('cell', { name: '92' })).toBeVisible()
  await sheet.getByLabel('Counted WIDGET').fill('90')
  await sheet.getByLabel('Counted TOY').fill('105')
  await expect(sheet.getByText('-2')).toBeVisible()
  await sheet.getByRole('button', { name: 'Post differences' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'differences were adjusted' })).toBeVisible()

  // ---- valuation agrees with the books ----
  await goTo(page, 'Valuation')
  await expect(page.getByText('The stock records agree with the inventory accounts.')).toBeVisible()

  // ---- every movement is on record ----
  await goTo(page, 'Movements')
  await expect(page.getByRole('cell', { name: /SA\/\d{4}\/000001/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Stock count' })).toBeVisible()
  await page.getByRole('cell', { name: /SA\/\d{4}\/000001/ }).click()
  await expect(page.getByRole('dialog', { name: /SA\// }).getByText('-3')).toBeVisible()
})
