import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('group report: two companies side by side, with inter-company accounts taken out', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'gr' })
  const second = await s.call('POST', '/v1/companies', { legalName: 'Second Co Pvt Ltd', pan: 'ABCDE1234F' })
  await s.call('POST', `/v1/companies/${second.id as string}/chart-of-accounts/template`, { template: 'manufacturing_india' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await goTo(page, 'Financial reports')
  await page.getByRole('tab', { name: 'Group (all companies)' }).click()
  const table = page.getByRole('table', { name: 'Group trial balance' })
  await expect(table).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Second Co Pvt Ltd' })).toBeVisible()
  await expect(page.getByText('Eliminated accounts')).toBeVisible()
  await table.getByLabel(/Eliminate/).first().check()
  await expect(page.getByText('1', { exact: true }).first()).toBeVisible()
})
