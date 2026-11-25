import { expect, test } from '@playwright/test'
import { goTo } from '../nav'
import { seedBusiness } from '../seed'

test('leads: connect the website, a lead arrives, is followed up, becomes a customer, and the numbers show where it came from', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'ld' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  // an empty start points at the sources
  await goTo(page, 'Leads')
  await expect(page.getByRole('heading', { name: 'Leads', exact: true })).toBeVisible()
  await expect(page.getByText(/No leads yet/)).toBeVisible()

  // connect the website
  await goTo(page, 'Lead sources')
  await page.getByRole('button', { name: 'Add a source' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Solar website')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Solar website is ready')).toBeVisible()
  const address = (await page.locator('code').first().textContent()) ?? ''
  expect(address).toContain('/v1/ingest/website/')
  await page.keyboard.press('Escape')

  // a form on the website posts an enquiry (as a browser would, with no sign-in)
  const post = await fetch(address, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ name: 'Meena Joshi', phone: '98100 00022', city: 'Pune', utm_source: 'facebook', utm_campaign: 'summer-solar', monthly_bill: '4500' }) })
  expect(post.status).toBe(200)
  await page.getByRole('button', { name: 'Send test lead' }).click()
  await expect(page.getByText('A test lead was created.')).toBeVisible()
  await page.getByRole('button', { name: 'Recent deliveries' }).click()
  await expect(page.getByText('created', { exact: true }).first()).toBeVisible()

  // it is on the board, waiting for the first call
  await goTo(page, 'Leads')
  const card = page.getByRole('button', { name: /Meena Joshi/ })
  await expect(card).toBeVisible()
  await expect(page.getByRole('region', { name: 'New' })).toContainText('Meena Joshi')
  await page.getByLabel('List view').click()
  await expect(page.getByRole('cell', { name: /Meena Joshi/ })).toBeVisible()
  await page.getByLabel('Board view').click()
  await card.click()
  await expect(page.getByRole('heading', { name: /Meena Joshi/ })).toBeVisible()
  await expect(page.getByText('summer-solar').first()).toBeVisible()
  await expect(page.getByText('4500')).toBeVisible() // the monthly bill from the form

  // follow up: a call, a task, a move, an edit
  await page.getByLabel('Log').selectOption('call')
  await page.getByLabel('What happened, or what to do').fill('Spoke to her, wants a 5 kW system')
  await page.getByRole('button', { name: 'Add to history' }).click()
  await expect(page.getByRole('list', { name: 'History' })).toContainText('Spoke to her')
  await page.getByLabel('Stage').selectOption({ label: 'Site survey' })
  await expect(page.getByRole('list', { name: 'History' })).toContainText('New → Site survey')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Expected value, ₹').fill('350000'); await page.getByLabel('System size (kW)').fill('5')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/3,50,000/).first()).toBeVisible()

  // make the customer, then a quotation starts with them chosen
  await page.getByRole('button', { name: 'Make customer' }).click()
  await page.getByLabel('Billing address').fill('12 Mill Road'); await page.getByLabel('State').selectOption({ label: 'Maharashtra' }); await page.getByLabel('PIN code').fill('411001')
  await page.getByRole('button', { name: 'Create customer' }).click()
  await expect(page.getByRole('button', { name: 'New quotation' })).toBeVisible()
  const parties = (await s.call('GET', '/v1/parties?limit=50')).items as unknown as { legalName: string; phone: string | null }[]
  expect(parties.find((p) => p.legalName === 'Meena Joshi')?.phone).toBe('98100 00022')
  await page.getByRole('button', { name: 'New quotation' }).click()
  await expect(page.getByRole('textbox', { name: 'Customer', exact: true })).toHaveValue(/Meena Joshi/)
  await page.goBack()

  // mark it won, and the report counts it
  await page.getByLabel('Stage').selectOption({ label: 'Won' })
  await expect(page.getByText('Won', { exact: true }).first()).toBeVisible()
  await goTo(page, 'Lead reports')
  await expect(page.getByRole('heading', { name: 'Lead reports' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Website', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'summer-solar' })).toBeVisible()

  // by hand, and the same person is caught
  await goTo(page, 'Leads')
  await page.getByRole('button', { name: 'New lead' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Ravi Kumar'); await page.getByLabel('Phone').fill('98100 00033')
  await page.getByRole('button', { name: 'Add lead' }).click()
  await expect(page.getByRole('heading', { name: /Ravi Kumar/ })).toBeVisible()
  await goTo(page, 'Leads')
  await page.getByRole('button', { name: 'New lead' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Ravi K'); await page.getByLabel('Phone').fill('+91 9810000033')
  await page.getByRole('button', { name: 'Add lead' }).click()
  await expect(page.getByText(/is already an open lead with this phone or email/)).toBeVisible()
  await page.getByRole('button', { name: 'Open that lead' }).click()
  await expect(page.getByRole('heading', { name: /Ravi Kumar/ })).toBeVisible()
})

test('leads: import a list, share leads out by turns, rename a stage, and record advert spend', async ({ page }) => {
  const s = await seedBusiness(process.env['E2E_BACKEND_URL'] as string, process.env['E2E_PLATFORM_TOKEN'] as string, { prefix: 'l2' })
  await page.goto('/')
  await page.getByLabel('Server address').fill(s.base); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  // settings: the owner takes the turns, a stage is renamed
  await goTo(page, 'Lead settings')
  await page.getByLabel('Assignment').selectOption('round_robin')
  await page.getByLabel(/Seed Owner/).check()
  await page.getByLabel('Answer a new lead within (minutes)').fill('10')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await page.getByLabel('Stage 3 name').fill('Survey booked')
  await page.getByRole('button', { name: 'Save stages' }).click()
  await expect(page.getByText('Stages saved.')).toBeVisible()

  // a list from a spreadsheet, with other column names and source words
  await goTo(page, 'Leads')
  await page.getByRole('button', { name: 'Import' }).click()
  const csv = 'Customer Name,Mobile,City,Lead Source,Ad campaign\nAsha Rao,9810000041,Pune,Facebook,Solar Q4\nRavi Kumar,9810000042,Thane,Google Ads,Search\nNo Contact,,Mumbai,Facebook,Solar Q4\n'
  await page.getByLabel('Data file').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await page.getByLabel('Column for Name').selectOption({ label: 'Customer Name' })
  await page.getByLabel('Column for Phone').selectOption({ label: 'Mobile' })
  await page.getByLabel('Column for Campaign').selectOption({ label: 'Ad campaign' })
  await page.getByRole('button', { name: /Check 3 rows/ }).click()
  await expect(page.getByText(/3 rows · 2 ready · 1 with problems/)).toBeVisible()
  await expect(page.getByText(/A phone number or an email is needed/)).toBeVisible()
  await page.getByRole('button', { name: 'Import 2 rows' }).click()
  await expect(page.getByText(/2 created/)).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  const leads = (await s.call('GET', '/v1/leads?limit=50')).items as unknown as { name: string; source: string; campaign: string | null; ownerId: string | null }[]
  expect(leads.map((l) => l.name).sort()).toEqual(['Asha Rao', 'Ravi Kumar'])
  expect(leads.find((l) => l.name === 'Asha Rao')).toMatchObject({ source: 'meta', campaign: 'Solar Q4' }); expect(leads.find((l) => l.name === 'Ravi Kumar')?.source).toBe('google')
  expect(leads.every((l) => l.ownerId)).toBe(true) // shared out on arrival
  await expect(page.getByRole('region', { name: 'Survey booked' })).toBeVisible()

  // spend, then the cost of a lead
  await goTo(page, 'Lead reports')
  await page.getByLabel('Source').selectOption('meta'); await page.getByLabel('Campaign (optional)').fill('Solar Q4'); await page.getByLabel('Amount, ₹').fill('1000')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Spend saved.')).toBeVisible()
  await expect(page.getByRole('cell', { name: /1,000\.00/ }).first()).toBeVisible()
})
