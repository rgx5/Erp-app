import { expect, test, type Page } from '@playwright/test'
import { accountMenu, goTo } from '../nav'
import { seedBusiness } from '../seed'

async function signIn(page: Page, prefix: string) {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  return s
}

test('settings and data have their own sections; working pages carry no import or export buttons', async ({ page }) => {
  await signIn(page, 'sl')
  await goTo(page, 'All settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: /Users/ })).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: /Tax codes/ })).toBeVisible()
  await page.getByRole('main').getByRole('link', { name: /^Roles/ }).click()
  await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible()

  for (const where of ['Items', 'Customers', 'Suppliers']) {
    await goTo(page, where)
    await expect(page.getByRole('heading', { name: where, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0)
  }
  await goTo(page, 'Import data')
  await expect(page.getByRole('heading', { name: 'Import data' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Import items/ })).toBeVisible()
  await goTo(page, 'Export data')
  await expect(page.getByRole('heading', { name: 'Export data' })).toBeVisible()
})

test('both layouts offer the same header (company, connection, alerts, account menu), a dark sidebar, and the Settings and Data areas', async ({ page }) => {
  await signIn(page, 'ly')
  const side = page.locator('[data-sidebar="dark"]')
  const check = async (): Promise<void> => {
    await expect(side).toBeVisible()
    expect(await side.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(12, 23, 71)')
    await expect(page.getByTitle('Connected to the server')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Notifications/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Account menu/ })).toBeVisible()
    await expect(page.locator('header a[href$="/organization/companies"]')).toBeVisible()
  }
  await check()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Data', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Account menu/ }).click()
  await page.getByRole('menuitem', { name: /command-centre layout/ }).click()
  await check()
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Data', exact: true })).toBeVisible()
  await accountMenu(page, 'Sign out')
})
