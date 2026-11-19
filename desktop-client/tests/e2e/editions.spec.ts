import { expect, test } from '@playwright/test'
import { openArea } from '../nav'
import { seedBusiness } from '../seed'

test('small shop edition: signs in to the counter, with a short menu and no accounting screens', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'edn' })
  await s.setLicence({ plan: 'Starter', modules: ['sales', 'inventory', 'pos'], limits: { users: 3 } })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug)
  await page.getByLabel('Email').fill(s.email)
  await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/#\/pos\/counter/) // the counter is home
  await expect(page.getByText('No counter yet')).toBeVisible()
  const menu = page.getByRole('navigation', { name: 'Main' })
  await expect(menu.getByRole('button', { name: 'Purchasing', exact: true })).toHaveCount(0)
  await expect(menu.getByRole('button', { name: 'Manufacturing', exact: true })).toHaveCount(0)
  await expect(menu.getByRole('button', { name: 'Payroll', exact: true })).toHaveCount(0)
  await expect(menu.getByRole('button', { name: 'Expenses', exact: true })).toBeVisible() // the only thing left of "Accounting"
  await openArea(page, 'Master data')
  await expect(menu.getByRole('link', { name: 'Items' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Tax codes' })).toHaveCount(0)

})
