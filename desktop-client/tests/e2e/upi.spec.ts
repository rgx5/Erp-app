import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('UPI: the business address is saved from the counter setup and refuses a malformed one', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'upi' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await goTo(page, 'Shifts and setup')
  await page.getByRole('tab', { name: 'Setup' }).click()
  const box = page.getByLabel('UPI address')
  await box.fill('bad address'); await expect(page.getByText('A UPI address such as shop@okbank')).toBeVisible()
  await box.fill('sunrise@okaxis')
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await expect(page.getByText('UPI address saved.')).toBeVisible()
  expect((await s.call('GET', `/v1/retail/settings?companyId=${s.company.id}`)).upiId).toBe('sunrise@okaxis')
})
