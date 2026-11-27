import { expect, type Page, test } from '@playwright/test'

import { registerMember, signIn, USERS } from '../helpers/e2e'

/**
 * End-to-end tests for the @xtr-dev/payload-notifications integration. Unread counts are read
 * from the page and checked relative to each other, so other suites that notify members don't
 * make these tests flaky.
 */

const bell = (page: Page) => page.getByTestId('notification-bell')
const inbox = (page: Page) => page.getByRole('region', { name: /^Notifications/ })
const unreadInInbox = async (page: Page) =>
  Number(await page.getByTestId('inbox-unread').textContent())

test.describe('Notifications (payload-notifications)', () => {
  test('a member sees the bell count, opens the inbox and marks a notification as read', async ({
    page,
  }) => {
    await signIn(page, USERS.jonas, '/workshops')

    const count = Number(await page.getByTestId('notification-count').textContent())
    expect(count).toBeGreaterThan(0)
    await expect(bell(page)).toHaveAccessibleName(`Notifications, ${count} unread`)

    await bell(page).click()
    await expect(page).toHaveURL(/\/account#notifications$/)
    await expect(inbox(page)).toBeVisible()
    expect(await unreadInInbox(page)).toBe(count)
    await expect(inbox(page).getByText('For you').first()).toBeVisible()
    await expect(inbox(page).getByText('Everyone').first()).toBeVisible()

    const item = inbox(page).locator('[data-testid="notification"][data-read="false"]').first()
    const title = (await item.getByRole('heading').textContent())!.replace(/^Unread: /, '')
    await item.getByRole('button', { name: `Mark “${title}” as read` }).click()

    await expect(page.getByTestId('inbox-unread')).toHaveText(String(count - 1))
    await expect(
      inbox(page).getByTestId('notification').filter({ hasText: title }).first(),
    ).toHaveAttribute('data-read', 'true')
    await expect(bell(page)).toHaveAccessibleName(
      count - 1 ? `Notifications, ${count - 1} unread` : 'Notifications',
    )
  })

  test('a new member follows channels and marks everything as read', async ({ page }) => {
    await registerMember(page, 'Noor Notify')
    await expect(inbox(page).getByText('Kiln firing schedule changed')).toBeVisible()

    // Unfollow Studio news: its broadcasts leave the inbox.
    const settings = page.getByTestId('notification-settings')
    await settings.getByLabel(/Studio news/).uncheck()
    await settings.getByRole('button', { name: 'Save channels' }).click()
    await expect(inbox(page).getByText('Kiln firing schedule changed')).toHaveCount(0)
    await expect(inbox(page).getByText('New: glaze mixing demo before class')).toBeVisible()
    await expect(settings.getByLabel(/Bookings/)).toBeDisabled()

    // The choice is stored as the plugin's channel subscription, which its REST endpoint lists
    // for the signed-in member, and it is still there after a reload.
    const mine = await page.request.get('/api/channel-subscriptions/me')
    expect(mine.status()).toBe(200)
    expect((await mine.json()).channels).toEqual([
      expect.objectContaining({ id: 'bookings', subscribed: true }),
      expect.objectContaining({ id: 'orders', subscribed: true }),
      expect.objectContaining({ id: 'class-reminders', subscribed: true }),
      expect.objectContaining({ id: 'studio-news', subscribed: false }),
    ])
    await page.reload()
    await expect(settings.getByLabel(/Studio news/)).not.toBeChecked()
    await expect(settings.getByLabel(/Class reminders/)).toBeChecked()

    // Without VAPID keys, push is off and says so.
    await expect(page.getByTestId('push-disabled')).toBeVisible()

    expect(await unreadInInbox(page)).toBeGreaterThan(0)
    await inbox(page).getByRole('button', { name: 'Mark all as read' }).click()
    await expect(page.getByTestId('inbox-unread')).toHaveText('0')
    await expect(page.getByTestId('notification-count')).toHaveCount(0)
    await expect(bell(page)).toHaveAccessibleName('Notifications')
  })

  test('shows the Notifications showcase section live', async ({ page }) => {
    await page.goto('/showcase#notifications')
    const section = page.locator('section#notifications')
    await expect(section.getByText('Live', { exact: true })).toBeVisible()
    await expect(section.getByTestId('showcase-broadcasts')).toContainText(
      'Open studio hours this weekend',
    )
    await expect(section.getByTestId('showcase-push-status')).toContainText('Off')
  })

  test('serves the plugin service worker', async ({ request }) => {
    const res = await request.get('/sw.js')
    expect(res.ok()).toBe(true)
    expect(res.headers()['content-type']).toContain('javascript')
    expect(await res.text()).toContain("addEventListener('push'")
  })
})
