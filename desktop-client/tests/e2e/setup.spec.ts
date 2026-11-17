import { expect, test } from '@playwright/test'
import { gstinCheckCharacter } from '../../src/domain/india'

const PASSWORD = 'a long passphrase for tests 42'
const gstin = (state: string, pan: string): string => { const first14 = `${state}${pan}1Z`; return first14 + gstinCheckCharacter(first14) }

test('a new business is set up end to end from the app, and is then ready to invoice', async ({ page }) => {
  const base = process.env['E2E_BACKEND_URL'] as string
  const slug = `setup-${Date.now().toString(36)}`
  const email = `owner@${slug}.example.com`
  const made = await fetch(`${base}/v1/platform/tenants`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env['E2E_PLATFORM_TOKEN']}` }, body: JSON.stringify({ name: 'Setup Co', slug, owner: { email, displayName: 'New Owner', password: PASSWORD } }) })
  expect(made.status).toBe(201)

  await page.goto('/')
  await page.getByLabel('Server address').fill(base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(slug)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // nothing exists yet: the dashboard points to setup
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await page.getByRole('link', { name: 'Set up your business' }).click()
  await expect(page.getByRole('heading', { name: 'Set up your business' })).toBeVisible()

  // 1. company: a bad PAN is stopped on the page
  await page.getByLabel('Legal name').fill('Bharat Fabrics Pvt Ltd')
  await page.getByLabel('PAN (optional)').fill('NOTAPAN')
  await page.getByRole('button', { name: 'Create company' }).click()
  await expect(page.getByText('A PAN looks like ABCDE1234F')).toBeVisible()
  await page.getByLabel('PAN (optional)').fill('ABCDE1234F')
  await page.getByRole('button', { name: 'Create company' }).click()

  // 2. GST registration: a mistyped GSTIN is caught before it reaches the server
  await expect(page.getByRole('heading', { name: 'GST registration' })).toBeVisible()
  const good = gstin('27', 'ABCDE1234F')
  await page.getByLabel('GSTIN').fill(good.slice(0, 14) + (good.endsWith('5') ? '6' : '5'))
  await page.getByRole('button', { name: 'Save GST registration' }).click()
  await expect(page.getByText('This GSTIN is not valid')).toBeVisible()
  await page.getByLabel('GSTIN').fill(good)
  await expect(page.getByText('State Maharashtra · PAN ABCDE1234F')).toBeVisible()
  await page.getByRole('button', { name: 'Save GST registration' }).click()

  // 3. place of business (state is taken from the GSTIN)
  await expect(page.getByRole('heading', { name: 'Place of business' })).toBeVisible()
  await expect(page.getByLabel('State')).toHaveValue('27')
  await page.getByLabel('Address', { exact: true }).fill('12 Mill Road')
  await page.getByLabel('City').fill('Mumbai')
  await page.getByLabel('Pincode').fill('12345')
  await page.getByRole('button', { name: 'Save place of business' }).click()
  await expect(page.getByText('A pincode has 6 digits')).toBeVisible()
  await page.getByLabel('Pincode').fill('400001')
  await page.getByRole('button', { name: 'Save place of business' }).click()

  // 4. warehouse, 5. financial year
  await expect(page.getByRole('heading', { name: 'Warehouse' })).toBeVisible()
  await page.getByRole('button', { name: 'Save warehouse' }).click()
  await expect(page.getByRole('heading', { name: 'Financial year' })).toBeVisible()
  await page.getByRole('button', { name: 'Open financial year' }).click()

  // 6. the standard Indian setup in one click
  await expect(page.getByRole('heading', { name: 'Standard setup' })).toBeVisible()
  await expect(page.getByText('Chart of accounts', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Apply standard setup' }).click()
  await expect(page.getByText('Setup is complete.')).toBeVisible()
  await expect(page.getByLabel('Not done')).toHaveCount(0)

  await page.getByRole('link', { name: 'Go to the dashboard' }).click()
  await expect(page.getByText('Bharat Fabrics Pvt Ltd')).toBeVisible()
  await expect(page.getByText('Setup is not finished')).toHaveCount(0)

  // leaving and coming back lands on a finished setup, not on step one
  await page.getByRole('link', { name: 'Setup' }).click()
  await expect(page.getByRole('heading', { name: 'Standard setup' })).toBeVisible()
  await expect(page.getByText('Setup is complete.')).toBeVisible()
})
