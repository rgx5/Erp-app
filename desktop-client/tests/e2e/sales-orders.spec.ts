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

test('sales: a quote becomes an order that is invoiced in two parts', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'qo' })
  await signIn(page, s)

  // ---- a quote ----
  await goTo(page, 'Quotes')
  await page.getByRole('button', { name: 'New quote' }).click()
  await page.getByLabel('Customer', { exact: true }).fill('Asha'); await page.getByRole('option', { name: /Asha Traders/ }).click()
  await page.getByLabel('Notes (optional)').fill('Delivery in two weeks')
  const item = page.getByLabel('Item', { exact: true }).first()
  await item.fill('wid'); await page.getByRole('option', { name: /WIDGET/ }).first().click()
  await page.getByLabel('Quantity', { exact: true }).first().fill('3')
  await page.getByLabel('Price', { exact: true }).first().fill('1000')
  await expect(page.getByLabel('Totals')).toContainText('3,540.00')
  await page.getByRole('button', { name: 'Save quote' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'QT/' })).toBeVisible()
  await page.getByRole('row', { name: /QT\// }).click()
  await expect(page.getByRole('table', { name: 'Quote lines' })).toContainText('3,540.00')
  await page.getByRole('button', { name: 'Make it a sales order' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'ORD/' })).toBeVisible()

  // ---- the order, invoiced in two parts ----
  await page.getByRole('row', { name: /ORD\// }).click()
  const order = page.getByRole('dialog', { name: /ORD\// })
  await order.getByLabel('Invoice WIDGET').fill('1')
  await order.getByRole('button', { name: 'Invoice', exact: true }).click()
  await expect(page.getByRole('heading', { name: /INV\// })).toBeVisible()
  await goTo(page, 'Sales orders')
  await expect(page.getByRole('row', { name: /ORD\// })).toContainText('Partly invoiced')
  await page.getByRole('row', { name: /ORD\// }).click()
  await page.getByRole('dialog', { name: /ORD\// }).getByRole('button', { name: 'Invoice', exact: true }).click()
  await expect(page.getByRole('heading', { name: /INV\// })).toBeVisible()
  await goTo(page, 'Sales orders')
  await expect(page.getByRole('row', { name: /ORD\// })).toContainText('Invoiced')
})
