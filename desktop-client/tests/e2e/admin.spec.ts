import { createHmac } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

async function signIn(page: Page, s: { base: string; slug: string; email: string; password: string }, code?: string) {
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug)
  await page.getByLabel('Email').fill(s.email)
  await page.getByLabel('Password').fill(s.password)
  if (code) await page.getByLabel(/code/i).fill(code)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}
/** RFC 6238 code for a base32 secret (30 s steps, SHA-1, 6 digits). */
function totp(secret: string, offset = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1]! & 15
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0')
}

test('administration: a limited role and user, an API key shown once, the audit log, password and two-step sign-in', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'adm' })
  await signIn(page, s)

  // ---- a role with a few permissions ----
  await goTo(page, 'Roles')
  await expect(page.getByRole('cell', { name: 'Owner' })).toBeVisible()
  await page.getByRole('button', { name: 'New role' }).click()
  const role = page.getByRole('dialog', { name: 'New role' })
  await role.getByLabel('Name', { exact: true }).fill('Shop assistant')
  await role.getByLabel('sales:read').check(); await role.getByLabel('masterdata:read').check(); await role.getByLabel('organization:read').check()
  await role.getByRole('button', { name: 'Create role' }).click()
  await expect(page.getByRole('cell', { name: 'Shop assistant' })).toBeVisible()

  // ---- a user with that role ----
  await goTo(page, 'Users')
  await page.getByRole('button', { name: 'Add user' }).click()
  const user = page.getByRole('dialog', { name: 'Add a user' })
  await user.getByLabel('Email').fill('asha@example.com'); await user.getByLabel('Name').fill('Asha Rao'); await user.getByLabel('Starting password').fill('a long starting passphrase 7')
  await user.getByLabel('Shop assistant').check()
  await user.getByRole('button', { name: 'Add user' }).click()
  await expect(page.getByRole('cell', { name: 'Asha Rao' })).toBeVisible()
  await expect(page.getByRole('row', { name: /Asha Rao/ })).toContainText('Shop assistant')

  // ---- an API key: shown once ----
  await goTo(page, 'API keys')
  await page.getByRole('button', { name: 'New API key' }).click()
  const key = page.getByRole('dialog', { name: 'New API key' })
  await key.getByLabel('Name', { exact: true }).fill('Accountant export'); await key.getByLabel('accounting:read').check()
  await key.getByRole('button', { name: 'Create key' }).click()
  const shown = page.getByRole('dialog', { name: 'Copy your key now' })
  await expect(shown.getByLabel('New API key')).not.toBeEmpty()
  await shown.getByRole('button', { name: 'I have saved it' }).click()
  await expect(page.getByRole('cell', { name: 'Accountant export' })).toBeVisible()
  await page.getByRole('button', { name: 'Revoke Accountant export' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'revoked' })).toBeVisible()

  // ---- the audit log has all of it ----
  await goTo(page, 'Audit log')
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()
  await expect(page.getByRole('cell', { name: /user/i }).first()).toBeVisible()
  await page.getByRole('row').nth(1).click()
  await expect(page.getByLabel('Audit entry')).toContainText('Request')
  await page.keyboard.press('Escape')

  // ---- two-step sign-in on my own account ----
  await goTo(page, 'My account')
  await page.getByRole('button', { name: 'Set up' }).click()
  const secret = (await page.getByLabel('Authenticator key').innerText()).trim()
  await page.getByLabel('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: 'Turn on' }).click()
  await expect(page.getByLabel('Recovery codes')).not.toBeEmpty()
  await page.getByRole('button', { name: 'I have saved them' }).click()
  await expect(page.getByText('Two-step sign-in is on.')).toBeVisible()

  // ---- the limited user sees only what the role allows ----
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByLabel('Business code').fill(s.slug)
  await page.getByLabel('Email').fill('asha@example.com')
  await page.getByLabel('Password').fill('a long starting passphrase 7')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'My account' })).toBeVisible()
})

test('licence: a tenant sees only the modules it has bought, and a suspended one is read-only with a notice', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'lic' })
  await s.setLicence({ plan: 'Starter', modules: ['sales', 'inventory'], limits: { users: 5 } })
  await signIn(page, s)
  const menu = page.getByRole('navigation', { name: 'Main' })
  await expect(menu.getByRole('link', { name: 'Invoices' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Stock on hand' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Purchase orders' })).toHaveCount(0)
  await expect(menu.getByRole('link', { name: 'Payroll runs' })).toHaveCount(0)
  await expect(menu.getByRole('link', { name: 'Journal entries' })).toHaveCount(0)
  await expect(menu.getByRole('link', { name: 'Items', exact: true })).toBeVisible() // master data is Core
  await page.keyboard.press('Control+k')
  const box = page.getByLabel('Search or run a command').last()
  await box.fill('purchase')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toContainText('Nothing matches')
  await page.keyboard.press('Escape')

  // suspended: a notice, and a write is refused with the reason
  await s.setLicence({ plan: 'Starter', modules: ['sales', 'inventory'], readOnly: true })
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'suspended' })).toBeVisible()
  const refused = await page.evaluate(async ([base, token]) => (await fetch(`${base}/v1/companies`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ legalName: 'X Pvt Ltd', pan: 'ABCDE1234F' }) })).json(), [s.base, s.token])
  expect((refused as { code: string }).code).toBe('tenant_read_only')
})
