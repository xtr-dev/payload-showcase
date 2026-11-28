import { expect, test } from '@playwright/test'

import { registerMember, signInWithForm, USERS } from '../helpers/e2e'

test.describe('home', () => {
  test('renders the hero, featured workshops and testimonials', async ({ page, baseURL }) => {
    // Pin the homepage hero A/B test to the control variant (see src/lib/experiments.ts).
    await page.context().addCookies([{ name: 'kiln_preview_home-hero', value: 'a', url: baseURL! }])
    await page.goto('/')
    await expect(page).toHaveTitle(/Kiln & Co\./)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Get your hands in the clay.')
    const featured = page.getByRole('region', { name: 'Start here' })
    await expect(featured.getByRole('article')).toHaveCount(3)
    await expect(page.getByRole('region', { name: /Made by our students/ })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible()
  })
})

test.describe('workshops', () => {
  test('lists published workshops and filters them', async ({ page }) => {
    await page.goto('/workshops')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('place at the wheel')
    await expect(page.getByTestId('result-count')).toHaveText('6 workshops')
    await expect(page.getByText('Raku Firing Weekend')).toHaveCount(0)

    await page.getByLabel('Level').selectOption('advanced')
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page).toHaveURL(/level=advanced/)
    await expect(page.getByTestId('result-count')).toHaveText('1 workshop match your filters')
    await expect(
      page.getByRole('heading', { name: 'Advanced Throwing: Large Forms' }),
    ).toBeVisible()

    await page.getByRole('link', { name: 'Clear' }).click()
    await expect(page).toHaveURL(/\/workshops$/)
    await expect(page.getByTestId('result-count')).toHaveText('6 workshops')
    await page.getByLabel('Search').fill('glaze')
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page).toHaveURL(/q=glaze/)
    await expect(page.getByRole('heading', { name: 'Glaze Lab' })).toBeVisible()
  })

  test('shows a workshop with its upcoming sessions', async ({ page }) => {
    await page.goto('/workshops')
    await page.getByRole('link', { name: 'Wheel Throwing for Beginners' }).click()
    await expect(page).toHaveURL(/\/workshops\/wheel-throwing-for-beginners$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wheel Throwing for Beginners')
    await expect(page.getByText('€65 per seat')).toBeVisible()
    await expect(page.getByTestId('session')).toHaveCount(3)
    await expect(
      page
        .getByTestId('session')
        .first()
        .getByRole('link', { name: /^Book / }),
    ).toBeVisible()
  })

  test('returns 404 for draft and unknown workshops', async ({ page }) => {
    const res = await page.goto('/workshops/raku-firing-weekend')
    expect(res?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('collapsed')
  })
})

test.describe('accounts', () => {
  test('a seeded member can sign in and see their bookings', async ({ page }) => {
    // The only test that logs a seeded account in through the form (see createSeededSessions).
    await signInWithForm(page, USERS.mara)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back, Mara')
    const bookings = page.getByTestId('bookings')
    await expect(bookings.getByRole('listitem')).toHaveCount(2)
    await expect(bookings).toContainText('Wheel Throwing for Beginners')
    await expect(page.getByRole('region', { name: 'Membership' })).toContainText('Studio Member')

    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL('/')
    await page.goto('/account')
    await expect(page).toHaveURL(/\/login\?next=%2Faccount/)
  })

  test('rejects a wrong password', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(USERS.mara.email)
    await page.getByLabel('Password').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'don’t match' })).toBeVisible()
  })

  test('a new visitor can register and book a seat', async ({ page }) => {
    await registerMember(page, 'Pim Jansen')

    await page.goto('/workshops/glaze-lab')
    await page
      .getByTestId('session')
      .first()
      .getByRole('link', { name: /^Book / })
      .click()
    await expect(page.getByRole('heading', { name: 'Booking for Pim Jansen' })).toBeVisible()
    await page.getByRole('button', { name: /Reserve seat/ }).click()

    // Checkout (payload-billing) sends the visitor to the payment page; the seat is held meanwhile.
    await page.waitForURL(/\/api\/payload-billing\/test\/payment\//)
    await page.goto('/account')
    const bookings = page.getByTestId('bookings')
    await expect(bookings.getByRole('listitem')).toHaveCount(1)
    await expect(bookings).toContainText('Awaiting payment')
  })

  test('booking requires signing in first', async ({ page }) => {
    await page.goto('/workshops/mugs-handles')
    await page
      .getByTestId('session')
      .first()
      .getByRole('link', { name: /^Book / })
      .click()
    await expect(page).toHaveURL(/\/login\?next=%2Fbook%2F\d+/)
  })
})

test.describe('showcase', () => {
  test('has a section for every plugin', async ({ page }) => {
    await page.goto('/showcase')
    for (const pkg of [
      'billing',
      'mailing',
      'notifications',
      'feature-flags',
      'automation',
      'ecommerce',
    ]) {
      await expect(page.locator(`section[data-plugin="@xtr-dev/payload-${pkg}"]`)).toBeVisible()
    }
  })
})
