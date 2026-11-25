import { expect, test, type APIRequestContext } from '@playwright/test'

import { registerMember, USERS } from '../helpers/e2e'

/**
 * End-to-end tests for the @xtr-dev/payload-feature-flags integration.
 * Cookie names match src/lib/experiments.ts.
 */
const VISITOR_COOKIE = 'kiln_vid'
const HERO_PREVIEW_COOKIE = 'kiln_preview_home-hero'

const HEADINGS = {
  a: 'Get your hands in the clay.',
  b: 'Your first bowl is one evening away.',
}

/** Signs an API context in as the seeded admin. */
const adminApi = async (request: APIRequestContext) => {
  const res = await request.post('/api/users/login', { data: USERS.admin })
  expect(res.ok()).toBe(true)
  return request
}

const setFlag = async (
  request: APIRequestContext,
  name: string,
  data: { enabled?: boolean; rolloutPercentage?: number },
) => {
  const found = await request.get(`/api/feature-flags?where[name][equals]=${name}&limit=1`)
  const { docs } = (await found.json()) as { docs: Array<{ id: number }> }
  const res = await request.patch(`/api/feature-flags/${docs[0].id}`, { data })
  expect(res.ok()).toBe(true)
}

test.describe('FeatureFlags (payload-feature-flags)', () => {
  for (const variant of ['a', 'b'] as const) {
    test(`renders hero variant ${variant} for a visitor pinned to it`, async ({
      page,
      baseURL,
    }) => {
      await page
        .context()
        .addCookies([{ name: HERO_PREVIEW_COOKIE, value: variant, url: baseURL! }])
      await page.goto('/')
      await expect(page.locator('[data-hero-variant]')).toHaveAttribute(
        'data-hero-variant',
        variant,
      )
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[variant])
    })
  }

  test('keeps a visitor on one hero variant and records exposure and conversion', async ({
    page,
    playwright,
    baseURL,
  }) => {
    await page.goto('/')
    const visitorId = (await page.context().cookies()).find((c) => c.name === VISITOR_COOKIE)?.value
    expect(visitorId).toBeTruthy()
    const variant = await page.locator('[data-hero-variant]').getAttribute('data-hero-variant')

    await page.reload()
    await expect(page.locator('[data-hero-variant]')).toHaveAttribute('data-hero-variant', variant!)

    const cta = page.locator('[data-hero-variant] a').first()
    await cta.click()
    await page.waitForURL((url) => url.pathname.startsWith('/workshops'))

    const api = await adminApi(await playwright.request.newContext({ baseURL }))
    await expect
      .poll(async () => {
        const res = await api.get(
          `/api/experiment-events?where[visitorId][equals]=${visitorId}&sort=type`,
        )
        const { docs } = (await res.json()) as { docs: Array<{ type: string; variant: string }> }
        return docs.map((d) => `${d.type}:${d.variant}`)
      })
      .toEqual([`conversion:${variant}`, `exposure:${variant}`])
    await api.dispose()
  })

  test('shows the debug panel, previews a variant and resets the assignment', async ({ page }) => {
    await page.goto('/showcase#feature-flags')
    const section = page.locator('#feature-flags')
    await expect(section.getByText('Live', { exact: true })).toBeVisible()

    const panel = page.getByTestId('flag-debug')
    for (const flag of ['home-hero', 'gift-cards', 'new-booking-flow']) {
      const server = await panel.getByTestId(`server-${flag}`).textContent()
      const client = panel.getByTestId(`client-${flag}`)
      await expect(client).toHaveText(server!)
    }

    await panel.getByRole('button', { name: 'Preview hero B' }).click()
    await expect(panel.getByTestId('server-home-hero')).toHaveText('b')
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS.b)

    await page.goto('/showcase#feature-flags')
    const before = await panel.getByTestId('visitor-id').textContent()
    await panel.getByRole('button', { name: 'Reset my assignment' }).click()
    await expect(panel.getByTestId('visitor-id')).not.toHaveText(before!)
    expect((await page.context().cookies()).some((c) => c.name === HERO_PREVIEW_COOKIE)).toBe(false)
  })

  test.describe('gift cards', () => {
    test('appear and disappear with the gift-cards flag', async ({ page, playwright, baseURL }) => {
      const api = await adminApi(await playwright.request.newContext({ baseURL }))
      const nav = page.getByRole('navigation', { name: 'Main' }).first()
      try {
        await page.goto('/')
        await expect(nav.getByRole('link', { name: 'Gift cards' })).toBeVisible()
        await page.goto('/gift-cards')
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Give someone')

        await setFlag(api, 'gift-cards', { enabled: false })
        await page.goto('/')
        await expect(nav.getByRole('link', { name: 'Gift cards' })).toHaveCount(0)
        const res = await page.goto('/gift-cards')
        expect(res?.status()).toBe(404)

        await setFlag(api, 'gift-cards', { enabled: true })
        await page.goto('/')
        await expect(nav.getByRole('link', { name: 'Gift cards' })).toBeVisible()
      } finally {
        await setFlag(api, 'gift-cards', { enabled: true })
        await api.dispose()
      }
    })
  })

  test('rolls BookingFlowV2 out and hands over to billing checkout', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const api = await adminApi(await playwright.request.newContext({ baseURL }))
    try {
      // Roll out to everyone, so the new member is certainly in the rollout.
      await setFlag(api, 'new-booking-flow', { rolloutPercentage: 100 })
      await registerMember(page, 'Fenna Flags')
      await page.goto('/workshops/hand-building-pinch-coil-slab')
      await page
        .getByTestId('session')
        .first()
        .getByRole('link', { name: /^Book / })
        .click()
      const flow = page.locator('[data-booking-flow]')
      await expect(flow).toHaveAttribute('data-booking-flow', 'v2')
      await flow.getByLabel('I throw regularly').check()
      await flow.getByLabel(/Anything we should know/).fill('Left-handed')
      await expect(page.getByTestId('booking-summary')).toContainText(
        'Experience: I throw regularly.',
      )
      await page.getByRole('button', { name: /^Reserve seat/ }).click()
      await page.waitForURL(/\/api\/payload-billing\/test\/payment\//)

      await page.goto('/account')
      await expect(page.getByTestId('bookings')).toContainText('Awaiting payment')
    } finally {
      await setFlag(api, 'new-booking-flow', { rolloutPercentage: 50 })
      await api.dispose()
    }
  })
})
