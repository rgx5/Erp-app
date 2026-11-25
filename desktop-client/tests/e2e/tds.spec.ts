import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('TDS: deduct from a supplier payment, see it in the register, and record the deposit', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'td' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Payments')
  await page.getByRole('button', { name: /Record payment|New payment|Pay a supplier/ }).first().click()
  const pay = page.getByRole('dialog', { name: 'Record a payment' })
  await pay.getByRole('textbox', { name: 'Supplier', exact: true }).fill('vend'); await page.getByRole('option', { name: /Vendor Supplies/ }).click()
  await pay.getByLabel('Amount paid').fill('100000')
  await pay.getByLabel('Deduct TDS from this payment').check()
  await pay.getByLabel('Section').selectOption('194J-P')
  await expect(pay.getByText(/The bank pays/)).toContainText('90,000.00')
  await pay.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'PAY/' })).toBeVisible()

  await goTo(page, 'TDS')
  const reg = page.getByRole('table', { name: 'TDS register' })
  await expect(reg.getByRole('row', { name: /Vendor Supplies.*194J-P.*10,000\.00/ })).toBeVisible()
  await reg.getByLabel(/Choose PAY/).check()
  await page.getByRole('button', { name: /Record deposit \(1\)/ }).click()
  await page.getByLabel('Challan number').fill('0510001')
  await page.getByRole('button', { name: 'Record deposit', exact: true }).click()
  await expect(page.getByText('The deposit was recorded.')).toBeVisible()
  await expect(reg.getByText(/Deposited .*0510001/)).toBeVisible()
})
