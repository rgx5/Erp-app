import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('reorder: set a level on an item, see it on the reorder list, and start a purchase order from it', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'ro' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Reorder list')
  await expect(page.getByText('Nothing needs reordering.')).toBeVisible()

  await goTo(page, 'Items')
  await page.getByRole('cell', { name: 'WIDGET', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Steel widget' })
  await drawer.getByLabel('Reorder level (optional)').fill('100000')
  await drawer.getByLabel('Reorder quantity (optional)').fill('20')
  await drawer.getByRole('button', { name: /Save/ }).click()
  await expect(drawer).toBeHidden()

  await goTo(page, 'Reorder list')
  const table = page.getByRole('table', { name: 'Reorder list' })
  await expect(table).toContainText('WIDGET')
  await expect(table.getByRole('row', { name: /WIDGET/ })).toContainText('20')
  await page.getByRole('button', { name: /Create purchase order/ }).click()
  await expect(page).toHaveURL(/#\/purchasing\/orders\/new/)
  await expect(page.getByLabel('Quantity').first()).toHaveValue('20')
  await expect(page.getByLabel('Price').first()).toHaveValue('400')
})
