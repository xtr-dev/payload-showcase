import { expect, test, type Page } from '@playwright/test'

import { registerMember, signIn, signInToAdmin, USERS } from '../helpers/e2e'

/**
 * End-to-end tests for the @xtr-dev/payload-billing integration: a full checkout through the
 * plugin's test provider, the return page, the account area and an admin refund.
 */

/** Books the first open session of a workshop and lands on the test provider's checkout. */
const bookWorkshop = async (page: Page, slug: string) => {
  await page.goto(`/workshops/${slug}`)
  await page
    .getByTestId('session')
    .first()
    .getByRole('link', { name: /^Book / })
    .click()
  await page.getByRole('button', { name: /^Reserve seat/ }).click()
  await page.waitForURL(/\/api\/payload-billing\/test\/payment\/test_pay_/)
}

/** Picks a method and scenario on the test provider's checkout page and submits it. */
const payOnTestProvider = async (page: Page, scenario: string) => {
  await expect(page.getByText('Test Payment Checkout')).toBeVisible()
  await page.locator('.method[data-method="ideal"]').click()
  await page.locator(`.scenario[data-scenario="${scenario}"]`).click()
  await page.getByRole('button', { name: 'Process Test Payment' }).click()
}

test.describe('Billing (payload-billing)', () => {
  test('a member books a workshop and pays through the test provider', async ({ page }) => {
    await registerMember(page, 'Ilse Klei')
    await bookWorkshop(page, 'wheel-throwing-for-beginners')
    await expect(page.locator('.amount')).toHaveText('EUR 65.00')
    await payOnTestProvider(page, 'instant-success')

    // The test provider redirects to the site's return page once the payment is through.
    await page.waitForURL(/\/checkout\/return\?t=[0-9a-f]{32}$/, { timeout: 20_000 })
    await expect(page.getByTestId('checkout-heading')).toHaveText('You’re booked in!')
    const result = page.getByTestId('checkout-result')
    await expect(result).toContainText('Wheel Throwing for Beginners')
    await expect(result).toContainText('Paid')
    await expect(result).toContainText('€65')

    await page.getByRole('link', { name: 'View invoice' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^INV-\d+$/)
    await expect(page.getByRole('article')).toContainText('Ilse Klei')
    await expect(page.getByRole('article')).toContainText('Paid')

    await page.goto('/account')
    await expect(page.getByTestId('bookings')).toContainText('Paid')
    const payments = page.getByTestId('payments')
    await expect(payments.getByRole('listitem')).toHaveCount(1)
    await expect(payments).toContainText('Wheel Throwing for Beginners')
    await expect(payments).toContainText('Paid')
    await expect(page.getByTestId('invoices').getByRole('listitem')).toHaveCount(1)
  })

  test('a declined payment can be retried, and an admin refund frees the seat', async ({
    page,
    browser,
  }) => {
    await registerMember(page, 'Pim Draaischijf')
    await bookWorkshop(page, 'glaze-lab')
    await payOnTestProvider(page, 'declined-payment')

    // The test provider sends the visitor back to the site's return page after a decline too.
    await page.waitForURL(/\/checkout\/return\?t=[0-9a-f]{32}$/, { timeout: 20_000 })
    await expect(page.getByTestId('checkout-heading')).toHaveText('Your payment didn’t go through')
    await expect(page.getByTestId('checkout-result')).toContainText('Declined')
    await expect(page.getByTestId('checkout-result')).toContainText('Your seat stays reserved')

    // The account lists the declined payment; the booking still holds its seat and is paid again
    // from the return page.
    await page.goto('/account')
    await expect(page.getByTestId('payments')).toContainText('Declined')
    await page.goBack()
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.waitForURL(/\/api\/payload-billing\/test\/payment\/test_pay_/)
    await payOnTestProvider(page, 'instant-success')
    await page.waitForURL(/\/checkout\/return/, { timeout: 20_000 })
    await expect(page.getByTestId('checkout-heading')).toHaveText('You’re booked in!')
    const reference = (
      await page.getByTestId('checkout-result').locator('.font-mono').textContent()
    )?.trim()
    expect(reference).toMatch(/^KC-/)

    // The admin refunds the booking from its edit view.
    const admin = await (await browser.newContext()).newPage()
    await signInToAdmin(admin)
    const res = await admin.request.get(
      `/api/bookings?where[reference][equals]=${reference}&depth=0`,
    )
    const { docs } = (await res.json()) as {
      docs: Array<{ id: number; session: number; status: string }>
    }
    expect(docs[0].status).toBe('paid')
    const seats = async () =>
      (
        (await (await admin.request.get(`/api/sessions/${docs[0].session}`)).json()) as {
          seatsLeft: number
        }
      ).seatsLeft
    const held = await seats()

    await admin.goto(`/admin/collections/bookings/${docs[0].id}`)
    admin.once('dialog', (dialog) => dialog.accept())
    await admin.getByRole('button', { name: 'Refund booking' }).click()
    await expect(admin.getByText('Booking is now refunded')).toBeVisible()
    expect(await seats()).toBe(held + 1)
    await admin.context().close()

    await page.goto('/account')
    await expect(page.getByTestId('bookings')).toContainText('Refunded')
    await expect(page.getByTestId('payments').getByRole('listitem').first()).toContainText(
      'Refunded',
    )
  })

  test('a cancelled payment also returns to the site', async ({ page }) => {
    await registerMember(page, 'Kees Kleiduif')
    await bookWorkshop(page, 'mugs-handles')
    await payOnTestProvider(page, 'cancelled-payment')
    await page.waitForURL(/\/checkout\/return\?t=[0-9a-f]{32}$/, { timeout: 20_000 })
    await expect(page.getByTestId('checkout-heading')).toHaveText('Your payment didn’t go through')
    await expect(page.getByTestId('checkout-result')).toContainText('Cancelled')
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('a seeded member sees their payment history and can pay an open booking', async ({
    page,
  }) => {
    await signIn(page, USERS.mara)
    const payments = page.getByTestId('payments')
    await expect(payments).toContainText('Partly refunded')
    await expect(payments).toContainText('refunded')
    await expect(page.getByTestId('invoices').getByRole('listitem')).toHaveCount(5)
    await payments.getByRole('link', { name: 'Pay now' }).click()
    await page.waitForURL(/\/api\/payload-billing\/test\/payment\/test_pay_/)
    await expect(page.getByText('Test Payment Checkout')).toBeVisible()
  })

  test('shows the Billing showcase section live', async ({ page }) => {
    await page.goto('/showcase#billing')
    const section = page.locator('#billing')
    await expect(section.getByText('Live', { exact: true })).toBeVisible()
    await expect(section.getByTestId('billing-showcase')).toContainText('How a booking is paid')
    await expect(section.getByTestId('billing-showcase')).toContainText('Payments taken')
  })
})
