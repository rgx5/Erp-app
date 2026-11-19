import type { Page } from '@playwright/test'

/** Goes to a page by its menu name, the way a keyboard user does: Ctrl+K, type, Enter. */
export async function goTo(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Control+k')
  const box = page.getByLabel('Search or run a command').last()
  await box.fill(name)
  await box.press('Enter')
}

/** Opens the account menu (top right) and picks an entry from it. */
export async function accountMenu(page: Page, entry: 'Sign out' | 'My account and layout'): Promise<void> {
  await page.getByRole('button', { name: /^Account menu/ }).click()
  await page.getByRole('menuitem', { name: entry }).click()
}
/** Opens an area of the sidebar (Sales, Inventory...) so its pages are listed. */
export async function openArea(page: Page, area: string): Promise<void> {
  const b = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: area, exact: true })
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click()
}
