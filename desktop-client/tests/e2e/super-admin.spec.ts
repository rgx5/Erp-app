import { expect, test, type Page } from '@playwright/test'
import { goTo } from '../nav'
import { PASSWORD, seedBusiness } from '../seed'

async function signIn(page: Page, base: string, slug: string, email: string) {
  await page.goto('/')
  await page.getByLabel('Server address').fill(base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(slug); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('company admin vs super admin: the owner cannot move data or change the licence, our Super admin can; the owner never sees the Super admin', async ({ page, browser }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'sa' })
  const support = `support@${s.slug}.example.com`
  const r = await fetch(`${s.base}/v1/platform/tenants/${s.tenantId}/super-admin`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env['E2E_PLATFORM_TOKEN']}` }, body: JSON.stringify({ email: support, displayName: 'OneSync Support', password: PASSWORD }) })
  expect(r.status).toBe(201)

  // the company's own admin
  await signIn(page, s.base, s.slug, s.email)
  await goTo(page, 'Move from another program')
  await expect(page).not.toHaveURL(/data\/migrate/)
  await page.keyboard.press('Escape')
  await goTo(page, 'Licensing')
  await expect(page.getByRole('heading', { name: 'Licensing' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save licence' })).toHaveCount(0)
  await goTo(page, 'Users')
  await expect(page.getByText('Seed Owner')).toBeVisible()
  await expect(page.getByText('OneSync Support')).toHaveCount(0)

  // our Super admin
  const ctx = await browser.newContext(); const p2 = await ctx.newPage()
  await signIn(p2, s.base, s.slug, support)
  await goTo(p2, 'Move from another program')
  await expect(p2).toHaveURL(/data\/migrate/)
  await goTo(p2, 'Licensing')
  await expect(p2.getByRole('button', { name: 'Save licence' })).toBeVisible()
  await goTo(p2, 'Users')
  await expect(p2.getByRole('cell', { name: 'OneSync Support' })).toBeVisible()
  await ctx.close()
})
