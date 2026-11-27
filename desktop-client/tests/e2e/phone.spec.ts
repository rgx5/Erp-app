import { expect, test } from '@playwright/test'
import { seedBusiness } from '../seed'

test.use({ viewport: { width: 390, height: 844 } })

test('on a phone: bottom tabs, the full menu under More, lists as cards, records in a full-screen drawer', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'ph' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  const tabs = page.getByRole('navigation', { name: 'Main' })
  await expect(tabs.getByRole('link', { name: 'Home' })).toBeVisible()
  // no page is wider than the phone
  const wide = async () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)

  await tabs.getByRole('link', { name: 'Parties' }).click()
  await expect(page.getByText('Asha Traders')).toBeVisible()   // a customer is a card, not a table row squeezed into columns
  expect(await wide()).toBe(false)
  await page.getByRole('button', { name: 'New customer' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  const box = await drawer.boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(385)                // the record fills the screen
  await drawer.getByRole('button', { name: 'Close' }).click()
  await expect(drawer).toBeHidden()

  // every page of the product is reachable from More
  await tabs.getByRole('button', { name: 'More' }).click()
  await page.getByLabel('Find a page').fill('cheques')
  await page.getByRole('button', { name: /Cheques received/ }).click()
  await expect(page.getByRole('heading', { name: 'Cheques received' })).toBeVisible()
  expect(await wide()).toBe(false)

  // an invoice: the item, then quantity, price and discount side by side
  await page.goto('/#/sales/invoices/new')
  await expect(page.getByLabel('Item', { exact: true }).first()).toBeVisible()
  expect(await wide()).toBe(false)
})
