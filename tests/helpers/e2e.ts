import { expect, type Page } from '@playwright/test'

/** Seeded logins (see src/seed/data.ts). Duplicated here so e2e tests don't import app code. */
export const USERS = {
  admin: { email: 'admin@kiln.test', password: 'kiln-admin' },
  mara: { email: 'mara@kiln.test', password: 'kiln-member', firstName: 'Mara' },
  jonas: { email: 'jonas@kiln.test', password: 'kiln-member', firstName: 'Jonas' },
}

/** Signs in through the site's own login form and waits for the account page. */
export const signIn = async (
  page: Page,
  user: { email: string; password: string },
  next = '/account',
) => {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === next)
}

/** Creates a fresh member through the registration form; returns their email. */
export const registerMember = async (page: Page, name: string): Promise<string> => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@kiln.test`
  await page.goto('/register')
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/account')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0])
  return email
}
