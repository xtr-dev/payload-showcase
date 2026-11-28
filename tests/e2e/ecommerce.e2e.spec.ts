import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { registerMember, USERS } from '../helpers/e2e'

/**
 * End-to-end tests for the @xtr-dev/payload-ecommerce integration: the shop's catalogue, cart and
 * checkout, paid through payload-billing's test provider. Every test uses a fresh browser context,
 * and so its own visitor cookie and its own cart.
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

/** Fills in the delivery form on /shop/checkout. Guests also give an email. */
const fillDelivery = async (page: Page, email?: string) => {
  const form = page.getByTestId('checkout-form')
  if (email) await form.getByLabel('Email').fill(email)
  await form.getByLabel('First name').fill('Guus')
  await form.getByLabel('Last name').fill('Gast')
  await form.getByLabel('Street and house number').fill('Strandweg 12')
  await form.getByLabel('Postcode').fill('2042 AA')
  await form.getByLabel('Town or city').fill('Zandvoort')
}

/** Picks a method and scenario on the test provider's checkout page and submits it. */
const payOnTestProvider = async (page: Page, scenario: string) => {
  await page.waitForURL(/\/api\/payload-billing\/test\/payment\/test_pay_/)
  await expect(page.getByText('Test Payment Checkout')).toBeVisible()
  await page.locator('.method[data-method="ideal"]').click()
  await page.locator(`.scenario[data-scenario="${scenario}"]`).click()
  await page.getByRole('button', { name: 'Process Test Payment' }).click()
  // The provider sends the customer back to the order page, with the order's token.
  await page.waitForURL(/\/shop\/orders\/ORD-[\d-]+\?t=[0-9a-f]{40}$/, { timeout: 20_000 })
}

const signInAsAdmin = async (page: Page) => {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(USERS.admin.email)
  await page.getByLabel('Password').fill(USERS.admin.password)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin$/)
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
    await expect(page.getByTestId('shop-promo')).toContainText('FREESHIP')

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

  test('a guest checks out with a discount code, pays and sees the confirmation', async ({
    page,
    browser,
  }) => {
    await page.goto('/shop/speckled-mug')
    await addToCart(page, { glaze: 'Celadon', quantity: 2 })
    await page.goto('/shop/cart')
    await page.getByLabel('Discount code').fill('WELCOME10')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByTestId('coupon-applied')).toBeVisible()
    await page.getByRole('link', { name: 'Checkout' }).click()
    await page.waitForURL('**/shop/checkout?code=WELCOME10')

    await expect(page.getByTestId('checkout-lines')).toContainText('2 × Speckled mug · Celadon')
    const summary = page.getByTestId('order-summary')
    await expect(summary).toContainText('WELCOME10')
    await expect(summary).toContainText('€57.35')
    await expect(page.getByText('Checking out as a guest.')).toBeVisible()

    // The server checks the form: an empty one comes back with a message per field.
    await page.getByRole('button', { name: 'Pay €57.35' }).click()
    await expect(page.getByText('Enter your first name.')).toBeVisible()
    await expect(page.getByText('Enter an email address')).toBeVisible()

    const email = `guest-${Date.now()}@kiln.test`
    await fillDelivery(page, email)
    await page.getByRole('button', { name: 'Pay €57.35' }).click()
    await page.waitForURL(/\/api\/payload-billing\/test\/payment\/test_pay_/)
    await expect(page.locator('.amount')).toHaveText('EUR 57.35')
    await payOnTestProvider(page, 'instant-success')

    await expect(page.getByTestId('order-heading')).toHaveText('Thank you, your order is in!')
    const result = page.getByTestId('order-result')
    await expect(result).toContainText('Paid')
    await expect(result).toContainText('2 × Speckled mug (Celadon)')
    await expect(result).toContainText('−€5.60')
    await expect(result).toContainText('€57.35')
    await expect(result).toContainText('Guus Gast')
    await expect(result).toContainText(email)
    await expect(page.getByTestId('cart-link')).toHaveCount(0)

    // Without its token the order does not exist for anyone else, and not through the API.
    const url = new URL(page.url())
    const stranger = await (await browser.newContext()).newPage()
    expect((await stranger.goto(url.pathname))?.status()).toBe(404)
    expect((await stranger.goto(`${url.pathname}?t=${'0'.repeat(40)}`))?.status()).toBe(404)
    expect((await stranger.goto(url.pathname + url.search))?.status()).toBe(200)
    const api = await stranger.request.get('/api/orders')
    expect(api.status()).toBe(403)
    await stranger.context().close()
  })

  test('a member’s order shows up in their account, is confirmed by email and ships', async ({
    page,
    browser,
  }) => {
    await registerMember(page, 'Noor Winkel')
    await page.goto('/shop/breakfast-bowl')
    await addToCart(page, { quantity: 3 })
    await page.goto('/shop/cart')
    // 3 × €34 = €102: free shipping. WELCOME10 takes €10.20 off.
    await page.getByLabel('Discount code').fill('WELCOME10')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByTestId('coupon-applied')).toBeVisible()
    await page.getByRole('link', { name: 'Checkout' }).click()
    await expect(page.getByText(/Signed in as e2e-/)).toBeVisible()
    const form = page.getByTestId('checkout-form')
    await expect(form.getByLabel('Email')).toHaveCount(0)
    await expect(form.getByLabel('First name')).toHaveValue('Noor')
    await fillDelivery(page)
    await page.getByRole('button', { name: 'Pay €91.80' }).click()
    await payOnTestProvider(page, 'instant-success')
    await expect(page.getByTestId('order-heading')).toHaveText('Thank you, your order is in!')
    const number = (await page.getByTestId('order-number').textContent())!.trim()

    await page.getByRole('link', { name: 'View invoice' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^INV-\d+$/)
    const invoice = page.getByRole('article')
    await expect(invoice).toContainText('Noor Winkel')
    // The line keeps its normal price; the coupon is the invoice's discount.
    await expect(invoice.getByRole('row', { name: /Breakfast bowl/ })).toContainText('€102')
    await expect(invoice.getByTestId('invoice-discount')).toContainText('−€10.20')
    await expect(invoice.getByRole('row', { name: /Total/ })).toContainText('€91.80')

    await page.goto('/account')
    const orders = page.getByTestId('orders')
    await expect(orders.getByRole('listitem')).toHaveCount(1)
    await expect(orders).toContainText('3 × Breakfast bowl')
    await expect(orders).toContainText(number)
    await expect(orders).toContainText('Paid')
    await expect(page.getByTestId('payments')).toContainText(`Shop order ${number}`)

    // The member reaches their order without the token.
    await orders.getByRole('link').click()
    await page.waitForURL(`**/shop/orders/${number}`)
    await expect(page.getByTestId('order-result')).toContainText('Paid')

    // payload-mailing: the confirmation arrives in the demo mailbox (the mail queue runs every
    // five seconds), with a link back to the order.
    await expect(async () => {
      await page.goto('/mailbox')
      await expect(
        page
          .getByRole('list', { name: 'Captured emails' })
          .getByRole('link', { name: `Your Kiln & Co. order ${number}` }),
      ).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 30_000 })
    await page.getByRole('link', { name: `Your Kiln & Co. order ${number}` }).click()
    const email = page.frameLocator('iframe[title^="Email:"]')
    await expect(email.getByText('Thank you, Guus')).toBeVisible()
    await expect(email.getByText('Items: 3 × Breakfast bowl')).toBeVisible()
    await expect(email.getByRole('link', { name: 'Follow your order' })).toHaveAttribute(
      'href',
      new RegExp(`/shop/orders/${number}\\?t=[0-9a-f]{40}$`),
    )

    // payload-notifications: an admin ships the order and the member hears about it.
    const admin = await (await browser.newContext()).newPage()
    await signInAsAdmin(admin)
    const found = await admin.request.get(
      `/api/orders?where[orderNumber][equals]=${number}&depth=0`,
    )
    const { docs } = (await found.json()) as { docs: Array<{ id: number }> }
    const shipped = await admin.request.patch(`/api/orders/${docs[0].id}`, {
      data: { status: 'shipped', trackingNumber: '3SKILN0042' },
    })
    expect(shipped.ok()).toBe(true)
    await admin.context().close()

    await page.goto('/account')
    await expect(page.getByRole('region', { name: /^Notifications/ })).toContainText(
      'Your order has shipped',
    )
    await expect(page.getByTestId('orders')).toContainText('Shipped')
    await page.goto(`/shop/orders/${number}`)
    await expect(page.getByTestId('order-heading')).toHaveText('Your order is on its way')
    await expect(page.getByTestId('order-result')).toContainText('3SKILN0042')
  })

  test('a declined payment cancels the order and the items can go back in the cart', async ({
    page,
  }) => {
    await page.goto('/shop/trimming-tool-set')
    await addToCart(page, {})
    await page.goto('/shop/checkout')
    await fillDelivery(page, 'declined@kiln.test')
    await page.getByRole('button', { name: /^Pay / }).click()
    await payOnTestProvider(page, 'declined-payment')

    await expect(page.getByTestId('order-heading')).toHaveText('Your payment didn’t go through')
    await expect(page.getByTestId('order-result')).toContainText('Cancelled')
    await expect(page.getByTestId('order-result')).toContainText('Nothing was charged')
    await page.getByRole('button', { name: 'Put it back in my cart' }).click()
    await page.waitForURL('**/shop/cart')
    await expect(page.getByTestId('cart-lines')).toContainText('Trimming tool set')
  })

  test('an admin refunds an order from its edit view, which restocks it', async ({
    page,
    browser,
  }) => {
    await page.goto('/shop/stoneware-clay-5-kg')
    await addToCart(page, { quantity: 2 })
    await page.goto('/shop/checkout')
    await fillDelivery(page, 'refund@kiln.test')
    await page.getByRole('button', { name: /^Pay / }).click()
    await payOnTestProvider(page, 'instant-success')
    await expect(page.getByTestId('order-result')).toContainText('Paid')
    const number = (await page.getByTestId('order-number').textContent())!.trim()

    const admin = await (await browser.newContext()).newPage()
    await signInAsAdmin(admin)
    const found = await admin.request.get(
      `/api/orders?where[orderNumber][equals]=${number}&depth=0`,
    )
    const { docs } = (await found.json()) as {
      docs: Array<{ id: number; status: string; items: Array<{ product: number }> }>
    }
    expect(docs[0].status).toBe('processing')
    const stock = async () =>
      (
        (await (await admin.request.get(`/api/products/${docs[0].items[0].product}`)).json()) as {
          inventory: { quantity: number }
        }
      ).inventory.quantity
    const held = await stock()

    await admin.goto(`/admin/collections/orders/${docs[0].id}`)
    admin.once('dialog', (dialog) => dialog.accept())
    await admin.getByRole('button', { name: 'Refund order' }).click()
    await expect(admin.getByText('Order is now refunded')).toBeVisible()
    expect(await stock()).toBe(held + 2)
    await admin.context().close()

    await page.reload()
    await expect(page.getByTestId('order-heading')).toHaveText('This order was refunded')
    await expect(page.getByTestId('order-result')).toContainText('Refunded')
  })

  test('shows the Shop showcase section live', async ({ page }) => {
    await page.goto('/showcase#ecommerce')
    const section = page.locator('#ecommerce')
    await expect(section.getByText('Live', { exact: true })).toBeVisible()
    const demo = section.getByTestId('ecommerce-showcase')
    await expect(demo).toContainText('From cart to doorstep')
    await expect(demo).toContainText('Products for sale')
    await section.getByRole('link', { name: 'Visit the shop' }).click()
    await page.waitForURL('**/shop')
  })

  test('the shop disappears while its flag is off', async ({ page, playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL })
    expect((await api.post('/api/users/login', { data: USERS.admin })).ok()).toBe(true)
    const nav = page.getByRole('navigation', { name: 'Main' }).first()
    try {
      await setShopFlag(api, false)
      await page.goto('/')
      await expect(nav.getByRole('link', { name: 'Shop', exact: true })).toHaveCount(0)
      for (const path of ['/shop', '/shop/speckled-mug', '/shop/cart', '/shop/checkout']) {
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
