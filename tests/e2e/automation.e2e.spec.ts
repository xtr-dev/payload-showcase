import { expect, test } from '@playwright/test'

import { signIn, USERS } from '../helpers/e2e'

/**
 * End-to-end tests for the @xtr-dev/payload-automation integration, against the seeded
 * production build: an admin confirms a booking in the admin panel and the studio log and run
 * history show the run; the kiln alert webhook needs its secret; admins can run the digest.
 */

/** The development default from src/seed/automation.ts, unless the server was given its own. */
const WEBHOOK_SECRET = process.env.AUTOMATION_WEBHOOK_SECRET || 'kiln-dev-webhook-secret-change-me'

test.describe('Automation (payload-automation)', () => {
  test('shows the Automation showcase section live with its workflows', async ({ page }) => {
    await page.goto('/showcase#automation')
    const section = page.locator('#automation')
    await expect(section.getByText('Live', { exact: true })).toBeVisible()
    await expect(section.getByTestId('workflow-card')).toHaveCount(5)
    // The scheduled workflow shows when it runs next.
    await expect(section.getByTestId('workflow-schedule')).toContainText('Next run')
    // Visitors don't get the manual run button.
    await expect(section.getByRole('button', { name: /studio digest/i })).toHaveCount(0)
  })

  test('an admin confirms a booking and the run shows up in the history', async ({ page }) => {
    await signIn(page, USERS.admin, '/showcase')

    // A booking of the admin's own, so the seeded members' bookings (which the billing spec
    // pays) stay untouched. Admins may create bookings through the REST API.
    const me = (await (await page.request.get('/api/users/me')).json()) as { user: { id: number } }
    const sessions = (await (
      await page.request.get('/api/sessions?sort=-startsAt&limit=1&depth=0')
    ).json()) as { docs: Array<{ id: number }> }
    const created = await page.request.post('/api/bookings', {
      data: { session: sessions.docs[0].id, member: me.user.id, status: 'pending' },
    })
    expect(created.status()).toBe(201)
    const bookingId = ((await created.json()) as { doc: { id: number } }).doc.id

    await page.goto(`/admin/collections/bookings/${bookingId}`)
    await page.locator('#field-status .rs__control').click()
    await page.locator('.rs__option', { hasText: 'Paid' }).click()
    await page.locator('#action-save').click()
    await expect(page.getByText(/updated successfully/i)).toBeVisible()

    await page.goto('/showcase/automation')
    const run = page.locator('[data-testid="workflow-run"][data-workflow="booking-confirmed"]')
    await expect(run.first()).toBeVisible()
    await expect(run.first().getByText('Completed')).toBeVisible()
    await expect(run.first().getByText('Send what-to-bring tips · ok')).toBeVisible()
    await expect(run.first().getByText('Write studio log · ok')).toBeVisible()

    await page.goto('/showcase#automation')
    await expect(
      page
        .getByTestId('studio-log')
        .getByText(/^Seat confirmed: /)
        .first(),
    ).toBeVisible()
    await expect(
      page
        .getByTestId('studio-log')
        .getByText(/Confirmation email: queued by mailing\./)
        .first(),
    ).toBeVisible()

    // The full run, with its trigger data and step outputs, is in the admin panel.
    await page.goto('/admin/collections/workflow-runs')
    await expect(page.getByRole('heading', { name: 'Workflow Runs' })).toBeVisible()
  })

  test('the kiln alert webhook needs its secret and logs the alert', async ({ page, request }) => {
    const url = '/api/automation/webhooks/kiln-alert'
    const data = { kiln: 'Big Bertha', temperatureC: 1301 }

    expect((await request.post(url, { data })).status()).toBe(401)
    expect(
      (await request.post(url, { data, headers: { 'X-Webhook-Secret': 'wrong' } })).status(),
    ).toBe(401)

    const ok = await request.post(url, { data, headers: { 'X-Webhook-Secret': WEBHOOK_SECRET } })
    expect(ok.status()).toBe(200)
    expect((await ok.json()).workflows).toEqual([expect.objectContaining({ status: 'triggered' })])

    await page.goto('/showcase#automation')
    const entry = page
      .getByTestId('studio-log')
      .locator('li', { hasText: 'Kiln alert: Big Bertha' })
    await expect(entry.first()).toBeVisible()
    // The HTTP step reached the site's mock pager and its answer made it into the log.
    await expect(entry.first()).toContainText('Paged Ines (kiln technician) (ticket PG-')
  })

  test('an admin runs the studio digest by hand and sees the result', async ({ page }) => {
    await signIn(page, USERS.admin, '/showcase')
    await page.goto('/showcase#automation')
    await page.getByRole('button', { name: 'Run the studio digest now' }).click()
    const result = page.getByTestId('digest-result')
    await expect(result.getByText('Completed')).toBeVisible()
    await expect(result.getByText('Email digest · ok')).toBeVisible()
  })
})
