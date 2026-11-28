import { type APIRequestContext, type BrowserContext, expect, type Page } from '@playwright/test'

/** Seeded logins (see src/seed/data.ts). Duplicated here so e2e tests don't import app code. */
export const USERS = {
  admin: { email: 'admin@kiln.test', password: 'kiln-admin' },
  mara: { email: 'mara@kiln.test', password: 'kiln-member', firstName: 'Mara' },
  jonas: { email: 'jonas@kiln.test', password: 'kiln-member', firstName: 'Jonas' },
}

type SeededUser = (typeof USERS)[keyof typeof USERS]

const sessionEnvName = (user: SeededUser) =>
  `E2E_SESSION_${Object.entries(USERS)
    .find(([, u]) => u.email === user.email)![0]
    .toUpperCase()}`

/**
 * Logs every seeded account in once, one after the other, and keeps the tokens in environment
 * variables, which the test workers inherit. Called from Playwright's global setup.
 *
 * The seeded accounts are shared by tests that run at the same time in different workers, and
 * Payload's login is not safe to run concurrently for one account: it reads the user, checks the
 * password and then writes the user's whole session list back, so of several logins that
 * overlap only the last one to write keeps its session and the others are signed out again on
 * their next request. Tests therefore never log a seeded account in themselves; they reuse these
 * sessions through `signIn`, `signInToAdmin` and `adminApi`. (`signInWithForm` is the exception,
 * for the one test that covers the login form.)
 */
export const createSeededSessions = async (request: APIRequestContext): Promise<void> => {
  for (const user of Object.values(USERS)) {
    const res = await request.post('/api/users/login', {
      data: { email: user.email, password: user.password },
    })
    if (!res.ok()) throw new Error(`Could not log in ${user.email} (${res.status()}).`)
    process.env[sessionEnvName(user)] = ((await res.json()) as { token: string }).token
  }
}

const sessionToken = (user: SeededUser): string => {
  const token = process.env[sessionEnvName(user)]
  if (!token) throw new Error(`No session for ${user.email}: did the global setup run?`)
  return token
}

/** Gives the browser context the seeded account's session cookie, as a login would. */
const addSessionCookie = (context: BrowserContext, user: SeededUser) =>
  context.addCookies([
    {
      name: 'payload-token',
      value: sessionToken(user),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])

/** Signs a seeded account in with its shared session and opens `next`. */
export const signIn = async (page: Page, user: SeededUser, next = '/account') => {
  await addSessionCookie(page.context(), user)
  await page.goto(next)
  await page.waitForURL((url) => url.pathname === next)
}

/** Signs the seeded admin in to the Payload admin panel with the shared session. */
export const signInToAdmin = async (page: Page) => {
  await addSessionCookie(page.context(), USERS.admin)
  await page.goto('/admin')
  await page.waitForURL(/\/admin$/)
}

/**
 * An API context that acts as the seeded admin, for changing data over REST. Dispose it when done.
 */
export const adminApi = (
  playwright: { request: { newContext: (options: object) => Promise<APIRequestContext> } },
  baseURL: string | undefined,
): Promise<APIRequestContext> =>
  playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `JWT ${sessionToken(USERS.admin)}` },
  })

/**
 * Signs in through the site's own login form and waits for the page it leads to. This creates a
 * new session, so at most one test may do it per seeded account (see `createSeededSessions`).
 */
export const signInWithForm = async (
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
