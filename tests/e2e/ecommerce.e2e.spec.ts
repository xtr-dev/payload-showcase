import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { USERS } from '../helpers/e2e'

/**
 * End-to-end tests for the @xtr-dev/payload-ecommerce integration: the shop's catalogue and cart.
 * Every test uses a fresh browser context, and so its own visitor cookie and its own cart.
 */

const setShopFlag = async (request: APIRequestContext, enabled: boolean) => {
  const found = await request.get('/api/feature-flags?where[name][equals]=shop&limit=1')
  const { docs } = (await found.json()) as { docs: Array<{ id: number }> }
  const res = await request.patch(`/api/feature-flags/${docs[0].id}`, { data: { enabled } })
  expect(res.ok()).toBe(true)
}

/** Adds the product on the current product page to the cart and waits for the confirmation. */
const addToCart = async (
  page: Page,
  { glaze, quantity }: { glaze?: string; quantity?: number },
) => {
  const form = page.getByTestId('add-to-cart')
  if (glaze) await form.getByRole('radio', { name: new RegExp(glaze) }).check()
  if (quantity) await form.getByLabel('Quantity').selectOption(String(quantity))
  await form.getByRole('button', { name: /^Add to cart/ }).click()
  await expect(form.getByText('Added to your cart')).toBeVisible()
}

test.describe('Shop (payload-ecommerce)', () => {
  test('lists active products with stock badges and filters by category', async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Main' })
      .first()
      .getByRole('link', { name: 'Shop', exact: true })
      .click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('studio home')

    const products = page.getByTestId('product')
    await expect(products).toHaveCount(6)
    await expect(page.getByText('Raku tea bowl')).toHaveCount(0)
    await expect(products.filter({ hasText: 'Kiln-door vase' })).toContainText('Sold out')
    await expect(products.filter({ hasText: 'Ochre serving plate' })).toContainText('Last one')
    await expect(products.filter({ hasText: 'Stoneware clay 5 kg' })).toContainText('Only 4 left')
    await expect(products.filter({ hasText: 'Speckled mug' })).toContainText('from €28')

    await page
      .getByRole('navigation', { name: 'Categories' })
      .getByRole('link', { name: 'Tools & clay' })
      .click()
    await expect(page.getByTestId('result-count')).toHaveText('2 products in Tools & clay')
    await expect(products).toHaveCount(2)

    // A draft product has no public page.
    const res = await page.goto('/shop/raku-tea-bowl-draft')
    expect(res?.status()).toBe(404)
  })

  test('a guest adds a glaze to the cart, changes it and tries a discount code', async ({
    page,
  }) => {
    await page.goto('/shop/speckled-mug')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speckled mug')
    await addToCart(page, { glaze: 'Cobalt', quantity: 2 })
    await expect(page.getByTestId('cart-link')).toHaveText('Cart (2)')

    await page.goto('/shop/breakfast-bowl')
    await addToCart(page, {})
    await page.getByTestId('add-to-cart').getByRole('link', { name: 'View cart' }).click()
    await page.waitForURL('**/shop/cart')

    const lines = page.getByTestId('cart-lines').getByRole('listitem')
    await expect(lines).toHaveCount(2)
    await expect(lines.first()).toContainText('Cobalt · €32 each')
    const summary = page.getByTestId('order-summary')
    // 2 × €32 + €34 = €98: over the free-shipping threshold.
    await expect(summary).toContainText('€98')
    await expect(summary).toContainText('Free')

    await page.getByLabel('Quantity of Speckled mug, Cobalt').selectOption('1')
    await page.getByRole('button', { name: 'Update Speckled mug, Cobalt' }).click()
    await expect(summary).toContainText('€6.95')
    await expect(summary).toContainText('€72.95')
    await expect(page.getByText('Add €9 more for free shipping.')).toBeVisible()

    await page.getByLabel('Discount code').fill('nope')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText('We don’t know that code.')).toBeVisible()

    await page.getByLabel('Discount code').fill('welcome10')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByTestId('coupon-applied')).toContainText('WELCOME10 takes €6.60 off.')
    await expect(summary).toContainText('€66.35')
    await expect(summary).toContainText('incl. 21% VAT')

    await page.getByRole('button', { name: 'Remove Breakfast bowl' }).click()
    await expect(lines).toHaveCount(1)
    await page.getByRole('button', { name: 'Remove Speckled mug, Cobalt' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your cart is empty')
    await expect(page.getByTestId('cart-link')).toHaveCount(0)
  })

  test('a sold-out product cannot be added, and stock limits the quantity', async ({ page }) => {
    await page.goto('/shop/kiln-door-vase')
    const button = page.getByTestId('add-to-cart').getByRole('button')
    await expect(button).toHaveText('Sold out')
    await expect(button).toBeDisabled()

    await page.goto('/shop/speckled-mug')
    await page.getByRole('radio', { name: /Cobalt/ }).check()
    await expect(page.getByLabel('Quantity').getByRole('option')).toHaveCount(3)
  })

  test('each visitor has their own cart', async ({ page, browser }) => {
    await page.goto('/shop/trimming-tool-set')
    await addToCart(page, {})

    const other = await (await browser.newContext()).newPage()
    await other.goto('/shop/cart')
    await expect(other.getByRole('heading', { level: 1 })).toHaveText('Your cart is empty')
    await other.context().close()
  })

  test('the shop disappears while its flag is off', async ({ page, playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL })
    expect((await api.post('/api/users/login', { data: USERS.admin })).ok()).toBe(true)
    const nav = page.getByRole('navigation', { name: 'Main' }).first()
    try {
      await setShopFlag(api, false)
      await page.goto('/')
      await expect(nav.getByRole('link', { name: 'Shop', exact: true })).toHaveCount(0)
      for (const path of ['/shop', '/shop/speckled-mug', '/shop/cart']) {
        expect((await page.goto(path))?.status(), path).toBe(404)
      }
    } finally {
      await setShopFlag(api, true)
      await api.dispose()
    }
    await page.goto('/')
    await expect(nav.getByRole('link', { name: 'Shop', exact: true })).toBeVisible()
  })
})
