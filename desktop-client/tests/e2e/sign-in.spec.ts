import { expect, test } from '@playwright/test'

const PASSWORD = 'a long passphrase for tests 42'

async function seed() {
  const base = process.env['E2E_BACKEND_URL'] as string
  const slug = `e2e-${Date.now().toString(36)}`
  const email = `owner@${slug}.example.com`
  const json = { 'content-type': 'application/json' }
  const made = await fetch(`${base}/v1/platform/tenants`, { method: 'POST', headers: { ...json, authorization: `Bearer ${process.env['E2E_PLATFORM_TOKEN']}` }, body: JSON.stringify({ name: 'E2E Co', slug, owner: { email, displayName: 'Asha Owner', password: PASSWORD } }) })
  expect(made.status).toBe(201)
  const login = (await (await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ tenant: slug, email, password: PASSWORD }) })).json()) as { accessToken: string }
  const auth = { ...json, authorization: `Bearer ${login.accessToken}` }
  const company = (await (await fetch(`${base}/v1/companies`, { method: 'POST', headers: auth, body: JSON.stringify({ legalName: 'Sunrise Traders Pvt Ltd', tradeName: 'Sunrise' }) })).json()) as { id: string }
  const fy = await fetch(`${base}/v1/fiscal-years`, { method: 'POST', headers: auth, body: JSON.stringify({ companyId: company.id, startDate: `${new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0)}-04-01` }) })
  expect(fy.status).toBe(201)
  return { base, slug, email }
}

test('connects to a server, signs in, sees the dashboard and companies, and signs out', async ({ page }) => {
  const { base, slug, email } = await seed()

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Connect to your server' })).toBeVisible()

  // a wrong address is explained, not a blank failure
  await page.getByLabel('Server address').fill('http://127.0.0.1:9')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  await page.getByLabel('Server address').fill(base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  // a wrong password is refused without saying which part was wrong
  await page.getByLabel('Business code').fill(slug)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('not the password at all')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('Sunrise')).toBeVisible()
  await expect(page.getByText('Cash and bank')).toBeVisible()
  await expect(page.getByText('₹ 0.00').first()).toBeVisible()
  await expect(page.getByText('Asha Owner')).toBeVisible()

  await page.getByRole('link', { name: 'Companies' }).click()
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Sunrise Traders Pvt Ltd' })).toBeVisible()

  // the address and business are remembered; the session is not (a browser has no keychain)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByLabel('Business code')).toHaveValue(slug)

  // protected pages bounce to sign-in
  await page.goto('/#/organization/companies')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
