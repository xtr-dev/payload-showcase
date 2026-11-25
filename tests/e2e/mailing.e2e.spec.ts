import { expect, test } from '@playwright/test'

import { registerMember, signIn, USERS } from '../helpers/e2e'

/**
 * End-to-end tests for the @xtr-dev/payload-mailing integration. The e2e server runs without
 * SMTP settings, so all mail lands in the capturing transport and the /mailbox page.
 */
test.describe('Mailing (payload-mailing)', () => {
  test('shows the Mailing showcase section live, with a rendered template', async ({ page }) => {
    await page.goto('/showcase#mailing')
    const section = page.locator('section#mailing')
    await expect(section.getByText('Live', { exact: true })).toBeVisible()
    const preview = section.frameLocator('iframe[title="Booking confirmation email preview"]')
    await expect(preview.getByText('See you at the wheel, Mara')).toBeVisible()
  })

  test('a member opts in to the newsletter and finds the confirmation in the mailbox', async ({
    page,
  }) => {
    await registerMember(page, 'Lotte Mailing')

    const setting = page.locator('[data-setting="newsletter"]')
    await expect(setting.getByText('Not subscribed')).toBeVisible()
    // The seed schedules next month's issue, so the setting can announce it.
    await expect(setting.getByText(/The next issue goes out on/)).toBeVisible()
    await setting.getByRole('button', { name: 'Subscribe to the newsletter' }).click()
    await expect(setting.getByText('Subscribed. We sent you a confirmation email.')).toBeVisible()
    await expect(setting.getByText('Subscribed', { exact: true })).toBeVisible()

    await setting.getByRole('link', { name: 'Open your demo mailbox' }).click()
    await page.waitForURL('**/mailbox')
    const inbox = page.getByRole('list', { name: 'Captured emails' })
    await inbox.getByRole('link', { name: /You’re on the list, Lotte/ }).click()
    await expect(page.getByRole('heading', { name: 'You’re on the list, Lotte' })).toBeVisible()
    const email = page.frameLocator('iframe[title^="Email:"]')
    await expect(email.getByText('Thanks, Lotte.')).toBeVisible()
    await expect(email.getByText(/The next issue goes out on/)).toBeVisible()
    // The opt-in also added the member to the scheduled issue.
    await expect(
      page.getByRole('region', { name: 'Scheduled' }).getByText(/^Studio notes for/),
    ).toBeVisible()

    // Opting out again takes the scheduled issue away.
    await page.goto('/account#settings')
    await setting.getByRole('button', { name: 'Unsubscribe' }).click()
    await expect(setting.getByText('Unsubscribed. You won’t get the next issue.')).toBeVisible()
    await page.goto('/mailbox')
    await expect(page.getByRole('region', { name: 'Scheduled' })).toContainText(
      'No scheduled email.',
    )
  })

  test('seeded members find their booking confirmation, and see only their own mail', async ({
    page,
  }) => {
    await signIn(page, USERS.jonas, '/mailbox')
    const inbox = page.getByRole('list', { name: 'Captured emails' })
    await expect(inbox.getByRole('link', { name: /^Booked: / }).first()).toBeVisible()
    await expect(inbox.getByRole('link', { name: /Welcome to Kiln & Co., Jonas/ })).toBeVisible()
    await expect(inbox.getByText(/Mara/)).toHaveCount(0)
  })
})
