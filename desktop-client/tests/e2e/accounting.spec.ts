import { expect, test, type Page } from '@playwright/test'
import { seedBusiness } from '../seed'

async function signIn(page: Page, s: { base: string; slug: string; email: string; password: string }) {
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug)
  await page.getByLabel('Email').fill(s.email)
  await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('accounting: a manual journal, its reversal, reports, periods and a bank statement reconciled', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'acc' })
  await s.call('POST', '/v1/bank-accounts', { companyId: s.company.id, accountId: s.bank, name: 'Current account', bankName: 'Test Bank', accountRef: '1234' })
  await signIn(page, s)

  // ---- chart of accounts ----
  await page.getByRole('link', { name: 'Chart of accounts' }).click()
  await expect(page.getByRole('heading', { name: 'Chart of accounts' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '1110' }).first()).toBeVisible()

  // ---- a manual journal that does not balance cannot be posted ----
  await page.getByRole('link', { name: 'Journal entries' }).click()
  await page.getByRole('button', { name: 'New journal' }).click()
  await page.getByLabel('Description').fill('Tea and snacks for the office')
  const accountsIn = page.getByLabel('Account', { exact: true })
  await accountsIn.nth(0).fill('5900')
  await page.getByRole('listbox').getByRole('option').first().click()
  await page.getByLabel('Debit').nth(0).fill('500')
  await accountsIn.nth(1).fill('1110')
  await page.getByRole('listbox').getByRole('option').first().click()
  await page.getByLabel('Credit').nth(1).fill('400')
  await expect(page.getByRole('button', { name: 'Post entry' })).toBeDisabled()
  await expect(page.getByLabel('Journal totals')).toContainText('Difference')
  await page.getByLabel('Credit').nth(1).fill('500')
  await expect(page.getByLabel('Journal totals')).toContainText('Balanced')
  await page.getByRole('button', { name: 'Post entry' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'posted' })).toBeVisible()

  // ---- reverse it from the list ----
  await page.getByRole('cell', { name: 'Tea and snacks for the office' }).click()
  const detail = page.getByRole('dialog')
  await expect(detail.getByText('Total')).toBeVisible()
  await detail.getByRole('button', { name: 'Reverse this entry' }).click()
  await detail.getByLabel('Reason').fill('Posted by mistake')
  await detail.getByRole('button', { name: 'Post reversal' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'reverses' })).toBeVisible()

  // ---- reports ----
  await page.getByRole('link', { name: 'Financial reports' }).click()
  await expect(page.getByRole('table', { name: 'Trial balance' })).toBeVisible()
  await page.getByRole('tab', { name: 'Profit and loss' }).click()
  await expect(page.getByText('Profit for the period').first()).toBeVisible()
  await page.getByRole('tab', { name: 'Balance sheet' }).click()
  await expect(page.getByText('Equity and liabilities')).toBeVisible()
  await page.getByRole('tab', { name: 'Cash flow' }).click()
  await expect(page.getByText('Agrees with the cash and bank balances in the books.')).toBeVisible()

  // ---- periods ----
  await page.getByRole('link', { name: 'Periods and year-end' }).click()
  await expect(page.getByRole('heading', { name: 'Periods and year-end' })).toBeVisible()
  const first = page.getByRole('button', { name: /^Close [A-Z][a-z]{2} \d{4}$/ }).first()
  const label = ((await first.getAttribute('aria-label')) ?? '').replace('Close ', '')
  await first.click()
  await expect(page.getByRole('status').filter({ hasText: 'closed' })).toBeVisible()
  await page.getByRole('button', { name: `Reopen ${label}` }).click()
  await expect(page.getByRole('status').filter({ hasText: 'reopened' })).toBeVisible()

  // ---- bank: import a statement, book the charge, reconcile ----
  await page.getByRole('link', { name: 'Bank reconciliation', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bank reconciliation' })).toBeVisible()
  const today = new Date().toISOString().slice(0, 10)
  await page.getByRole('button', { name: 'Import statement' }).click()
  const imp = page.getByRole('dialog', { name: 'Import a bank statement' })
  await imp.getByLabel('Statement file').setInputFiles({ name: 'stmt.csv', mimeType: 'text/csv', buffer: Buffer.from(`Date,Description,Reference,Amount\n${today},Bank charges,CHG1,-50\n`) })
  await expect(imp.getByText('1 lines')).toBeVisible()
  await imp.getByRole('button', { name: 'Import statement' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'imported' })).toBeVisible()
  await page.getByRole('cell', { name: 'Bank charges' }).click()
  const line = page.getByRole('dialog')
  await line.getByLabel('Post to account').fill('5900')
  await page.getByRole('listbox').getByRole('option').first().click()
  await line.getByRole('button', { name: 'Post entry and match' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Booked and matched' })).toBeVisible()
  await page.getByRole('tab', { name: 'Reconciliation' }).click()
  await expect(page.getByText('Reconciled: the statement agrees.')).toBeVisible()
})
