import { expect, test, type Page } from '@playwright/test'
import { goTo } from '../nav'
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
const pick = async (page: Page, label: string, text: string) => { await page.getByLabel(label, { exact: true }).fill(text); await page.getByRole('listbox').getByRole('option', { name: new RegExp(text) }).first().click() }

test('payroll: set up, add a person, run the month, pay the salaries and the statutory dues', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'pay' })
  const accts = (await s.call('GET', `/v1/accounts?companyId=${s.company.id}&limit=200`)).items as { id: string; code: string }[]
  const parent = (accts.find((a) => a.code === '2100') as { id: string }).id
  for (const [code, name] of [['2150', 'Salary payable'], ['2160', 'PF payable'], ['2170', 'ESI payable'], ['2180', 'PT payable'], ['2190', 'Other deductions payable']]) await s.call('POST', '/v1/accounts', { companyId: s.company.id, code, name, type: 'liability', parentId: parent })
  await signIn(page, s)

  // ---- setup: accounts, statutory rules, a component ----
  await goTo(page, 'Payroll setup')
  await pick(page, 'Salary expense', '5500'); await pick(page, 'Employer contributions expense', '5500')
  await pick(page, 'Salary payable', '2150'); await pick(page, 'PF payable', '2160'); await pick(page, 'ESI payable', '2170'); await pick(page, 'Professional tax payable', '2180')
  await pick(page, 'TDS on salary payable', '2240'); await pick(page, 'Other deductions payable', '2190')
  await page.getByRole('button', { name: 'Save accounts' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Payroll accounts saved' })).toBeVisible()
  await page.getByRole('tab', { name: 'Statutory rules' }).click()
  await page.getByRole('button', { name: /Load starting values/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Starting values loaded' })).toBeVisible()
  await expect(page.getByLabel('Statutory rules')).toContainText('12% / 12%')
  // a later change of a rate and of the income-tax slabs (new dated rules; nothing is overwritten)
  const next = `${new Date().getFullYear() + 1}-04-01`
  await page.getByRole('button', { name: 'Change rates' }).click()
  const rates = page.getByRole('dialog', { name: 'Change statutory rates' })
  await rates.getByLabel('Effective from').fill(next); await rates.getByLabel('PF wage ceiling').fill('21000')
  await rates.getByRole('button', { name: 'Save rates' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'rate(s) set' })).toBeVisible()
  await page.getByRole('button', { name: 'Income-tax slabs, new regime' }).click()
  const slabs = page.getByRole('dialog', { name: 'Income-tax slabs, new regime' })
  await expect(slabs.getByLabel('Up to 1')).toHaveValue('400000')
  await slabs.getByLabel('Effective from').fill(next)
  await slabs.getByRole('button', { name: 'Save slabs' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Slabs saved' })).toBeVisible()
  await page.getByRole('tab', { name: 'Pay components' }).click()
  await page.getByRole('button', { name: 'New component' }).click()
  const comp = page.getByRole('dialog', { name: 'New pay component' })
  await comp.getByLabel('Code').fill('HRA'); await comp.getByLabel('Name').fill('House rent allowance')
  await comp.getByLabel('Calculation').selectOption('percent_of_basic'); await comp.getByLabel('Percent of basic').fill('40')
  await comp.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('table', { name: 'Pay components' })).toContainText('40% of basic')

  // ---- a person with a salary structure ----
  await goTo(page, 'People')
  await page.getByRole('button', { name: 'Add person' }).click()
  const person = page.getByRole('dialog', { name: 'Add a person' })
  await person.getByLabel('Full name').fill('Ravi Kumar')
  await person.getByLabel('Provident fund applies').check(); await person.getByLabel('Professional tax applies').check()
  await person.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByRole('cell', { name: 'Ravi Kumar' })).toBeVisible()
  await page.getByRole('cell', { name: 'Ravi Kumar' }).click()
  const detail = page.getByRole('dialog', { name: /Ravi Kumar/ })
  await detail.getByLabel('Monthly basic').fill('30000')
  await detail.getByLabel('Include HRA').check()
  await detail.getByRole('button', { name: 'Save structure' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Salary structure saved' })).toBeVisible()
  await expect(detail.getByRole('table', { name: 'Salary structures' })).toContainText('HRA')
  await page.keyboard.press('Escape')

  // ---- this month's inputs, then the run ----
  await goTo(page, 'Payroll runs')
  await page.getByRole('tab', { name: 'Monthly inputs' }).click()
  await page.getByLabel('Bonus for Ravi Kumar').fill('1000')
  await page.getByRole('button', { name: 'Save Ravi Kumar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Ravi Kumar: saved' })).toBeVisible()
  await page.getByRole('tab', { name: 'Runs' }).click()
  await page.getByRole('button', { name: 'New payroll run' }).click()
  await page.getByRole('dialog', { name: 'New payroll run' }).getByRole('button', { name: 'Run payroll' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'posted' })).toBeVisible()
  const run = page.getByRole('dialog', { name: /PR\// })
  await expect(run.getByLabel('Run totals')).toContainText('Gross pay')
  await expect(run.getByRole('table', { name: 'Payslips in the run' })).toContainText('Ravi Kumar')
  await run.getByRole('button', { name: 'Payslip Ravi Kumar' }).click()
  await expect(page.getByLabel('Payslip', { exact: true })).toContainText('Net pay')
  await page.getByRole('dialog', { name: /^Payslip ·/ }).getByRole('button', { name: 'Close' }).click()

  // ---- pay the salaries ----
  await run.getByRole('button', { name: 'Mark as paid' }).click()
  await pick(page, 'Paid from (bank or cash)', '1120')
  await run.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'paid.' })).toBeVisible()
  await page.keyboard.press('Escape')

  // ---- statutory dues ----
  await goTo(page, 'Statutory dues')
  await expect(page.getByRole('table', { name: 'Statutory dues' })).toBeVisible()
  await page.getByRole('button', { name: /^Pay pf dues/ }).click()
  await pick(page, 'Paid from (bank or cash)', '1120')
  await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'REM/' })).toBeVisible()
})
