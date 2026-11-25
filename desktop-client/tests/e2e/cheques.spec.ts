import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('cheques: record one received, see it due, then cancel it', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'ch' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await goTo(page, 'Cheques received')
  await expect(page.getByText('No cheques here.')).toBeVisible()
  await page.getByRole('button', { name: 'Record a cheque' }).click()
  await page.getByLabel('Customer', { exact: true }).fill('asha')
  await page.getByRole('option', { name: /Asha/ }).first().click()
  await page.getByLabel('Cheque number').fill('000123')
  await page.getByLabel('Amount').fill('2500')
  await page.getByRole('button', { name: 'Save cheque' }).click()
  await expect(page.getByRole('cell', { name: '000123' })).toBeVisible()
  await expect(page.getByText('Due', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByLabel('Reason').fill('Customer paid in cash')
  await page.getByRole('button', { name: 'Cancel this cheque' }).click()
  await expect(page.getByText('No cheques here.')).toBeVisible()
})
