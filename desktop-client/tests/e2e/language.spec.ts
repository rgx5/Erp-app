import { expect, test } from '@playwright/test'
import { accountMenu, goTo } from '../nav'
import { seedBusiness } from '../seed'

test('language: the menus, the counter and printed headings follow the chosen language, and English is the default', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'ln' })
  const today = new Date().toISOString().slice(0, 10)
  const inv = await s.call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: today, customerId: s.customer.id, lines: [{ itemId: s.widget.id, quantity: '1', unitPrice: '1000', warehouseId: s.warehouse.id }] })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  const menu = page.getByRole('navigation', { name: 'Main' })
  await expect(menu.getByRole('link', { name: 'Dashboard' })).toBeVisible() // English by default

  await accountMenu(page, 'My account and layout')
  await page.getByLabel('Language (kept on this computer)').selectOption('hi')
  await expect(menu.getByRole('link', { name: 'डैशबोर्ड' })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'बिक्री', exact: true })).toBeVisible() // the Sales section
  await page.evaluate(() => { window.print = () => undefined })
  await page.evaluate((id) => { location.hash = `#/sales/invoices/${id}` }, inv.id as string)
  await page.getByRole('button', { name: 'Print' }).click()
  const printed = await page.evaluate(() => document.querySelector('iframe:last-of-type')?.getAttribute('srcdoc') ?? '')
  expect(printed).toContain('टैक्स इनवॉइस / Tax Invoice'); expect(printed).toContain('कुल योग / Grand total')

  await page.evaluate(() => document.querySelectorAll('iframe').forEach((f) => f.remove())) // the print frame is no longer needed
  await accountMenu(page, 'My account and layout')
  await page.getByLabel(/^(Language|भाषा)/).selectOption('mr')
  await expect(menu.getByRole('link', { name: 'डॅशबोर्ड' })).toBeVisible()
  await page.getByLabel(/^(Language|भाषा)/).selectOption('gu')
  await expect(menu.getByRole('link', { name: 'ડેશબોર્ડ' })).toBeVisible()
  await page.getByLabel(/^(Language|ભાષા)/).selectOption('en')
  await expect(menu.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  void goTo
})
