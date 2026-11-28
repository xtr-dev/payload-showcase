import { runScheduledTriggers } from '@xtr-dev/payload-automation/server'
import { getEcommerce } from '@xtr-dev/payload-ecommerce'
import { Cron } from 'croner'
import { randomUUID } from 'crypto'
import { createLocalReq, type Endpoint, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { FLAGS_SLUG } from '@/lib/experiments'
import { MAIL_QUEUES, TEMPLATES } from '@/lib/mailing'
import { MAIL_OUTBOX_SLUG } from '@/lib/mailOutbox'
import {
  addToCart,
  cancelStaleOrders,
  FREE_SHIPPING_FROM,
  getCartCount,
  getCartView,
  getOrderForVisitor,
  getStock,
  includedVat,
  MAX_LINE_QUANTITY,
  orderPath,
  orderToken,
  placeOrder,
  quoteCart,
  restoreCartFromOrder,
  setCartLineQuantity,
  SHIPPING_FLAT,
  shippingFor,
  STALE_ORDER_MINUTES,
  ShopError,
  toCartSession,
} from '@/lib/shop'
import type { Coupon, Invoice, Order, Payment, Product, User } from '@/payload-types'
import { seed, type SeedContext } from '@/seed'
import { RELEASE_UNPAID_ORDERS_SCHEDULE, WORKFLOW_SLUGS } from '@/seed/automation'
import { CATEGORY_SEEDS, COUPON_SEEDS, PRODUCT_SEEDS } from '@/seed/ecommerce'

import { getTestPayload, type TestPayload } from '../helpers/payload'

let t: TestPayload
let payload: Payload
let ctx: SeedContext
let mara: User
let jonas: User

const ADDRESS = {
  firstName: 'Mara',
  lastName: 'de Vries',
  address1: 'Strandweg 12',
  city: 'Zandvoort',
  postalCode: '2042 AA',
  country: 'NL',
}

beforeAll(async () => {
  t = await getTestPayload()
  payload = t.payload
  ctx = await seed(payload)
  ;[mara, jonas] = ctx.members
})

afterAll(async () => {
  await t?.cleanup()
})

const DELIVERY = { ...ADDRESS, firstName: 'Guus', lastName: 'Gast' }

const relId = (v: unknown) => (v && typeof v === 'object' ? (v as { id: number }).id : v)

/** Builds a request for calling an endpoint handler directly. */
const request = async (
  opts: { user?: User; body?: unknown; routeParams?: Record<string, string> } = {},
): Promise<PayloadRequest> => {
  const req = await createLocalReq(
    { user: opts.user ? { ...opts.user, collection: 'users' } : undefined },
    payload,
  )
  req.routeParams = opts.routeParams
  req.json = async () => opts.body
  return req
}

const paymentOf = async (order: Order): Promise<Payment> =>
  (
    await payload.find({
      collection: 'payments',
      where: { order: { equals: order.id } },
      sort: '-createdAt',
      limit: 1,
      depth: 0,
    })
  ).docs[0]

/** Pays (or declines) a test-provider payment the way its checkout page does. */
const settle = async (payment: Payment, scenarioId: string): Promise<Payment> => {
  const process = payload.config.endpoints.find(
    (e: Endpoint) => e.path === '/payload-billing/test/process' && e.method === 'post',
  )!
  const res = await process.handler(
    await request({ body: { paymentId: payment.providerId, scenarioId, method: 'ideal' } }),
  )
  expect(res.status).toBe(200)
  // The test provider applies the outcome after the scenario's delay (none for instant-success).
  for (let i = 0; i < 50; i++) {
    const current = await payload.findByID({ collection: 'payments', id: payment.id })
    if (current.status !== payment.status) return current
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Payment ${payment.id} was not settled`)
}

const reload = (order: Order) => payload.findByID({ collection: 'orders', id: order.id, depth: 0 })

const usageOf = async (code: string) =>
  (await payload.find({ collection: 'coupons', where: { code: { equals: code } } })).docs[0]
    .usageCount

const product = async (title: string): Promise<Product> => {
  const { docs } = await payload.find({
    collection: 'products',
    where: { title: { equals: title } },
    limit: 1,
  })
  return docs[0]
}

const variantStock = (p: Product, name: string) =>
  p.variants?.find((v) => v.name === name)?.inventory

/** Places an order for a session's cart the way checkout does: amounts come from the server. */
const orderFromCart = async (
  sessionId: string,
  { couponCode, user }: { couponCode?: string; user?: User } = {},
): Promise<Order> => {
  const cart = await getCartView(payload, sessionId)
  const quote = await quoteCart(payload, cart, { couponCode, user })
  if (user) await payload.update({ collection: 'carts', id: cart.id!, data: { user: user.id } })
  return getEcommerce(payload).orders.createOrderFromCart({
    cartId: cart.id!,
    orderData: {
      shippingAddress: ADDRESS,
      customerEmail: user?.email ?? 'guest@kiln.test',
      shipping: shippingFor(cart.subtotal),
      couponCode: quote.coupon?.code,
    },
  })
}

describe('Shop (payload-ecommerce)', () => {
  it('seeds the catalogue and coupon codes', async () => {
    const products = await payload.find({ collection: 'products', limit: 50 })
    expect(products.totalDocs).toBe(PRODUCT_SEEDS.length)
    expect(products.docs.every((p) => p.slug && p.images?.length === 1)).toBe(true)
    expect((await payload.count({ collection: 'categories' })).totalDocs).toBe(
      CATEGORY_SEEDS.length,
    )
    const coupons = await payload.find({ collection: 'coupons', sort: 'code' })
    expect(coupons.docs.map((c) => c.code)).toEqual(COUPON_SEEDS.map((c) => c.code).sort())

    const mug = await product('Speckled mug')
    expect(mug.slug).toBe('speckled-mug')
    expect(mug.variants?.map((v) => v.name)).toEqual(['Oat', 'Celadon', 'Cobalt'])
    expect((await product('Kiln-door vase')).inventory?.quantity).toBe(0)
  })

  it('shows the public only active products, and keeps coupons, carts and orders closed', async () => {
    const visible = await payload.find({ collection: 'products', overrideAccess: false, limit: 50 })
    expect(visible.totalDocs).toBe(PRODUCT_SEEDS.filter((p) => !p.status).length)
    expect(visible.docs.every((p) => p.status === 'active')).toBe(true)
    const categories = await payload.find({ collection: 'categories', overrideAccess: false })
    expect(categories.totalDocs).toBe(CATEGORY_SEEDS.length)

    for (const collection of ['coupons', 'carts', 'orders'] as const) {
      await expect(payload.find({ collection, overrideAccess: false })).rejects.toThrow()
    }
    await expect(
      payload.find({ collection: 'coupons', user: mara, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('lets only admins write products and orders', async () => {
    const bowl = await product('Breakfast bowl')
    await expect(
      payload.update({
        collection: 'products',
        id: bowl.id,
        data: { price: 1 },
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'orders',
        data: {
          items: [{ product: bowl.id, quantity: 1, price: 1, total: 1 }],
          subtotal: 1,
          total: 1,
          status: 'pending',
          paymentStatus: 'paid',
          shippingAddress: ADDRESS,
        },
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    const updated = await payload.update({
      collection: 'products',
      id: bowl.id,
      data: { sku: 'KC-BOWL' },
      user: ctx.admin,
      overrideAccess: false,
    })
    expect(updated.price).toBe(3400)
  })

  it('reports stock per variant', async () => {
    const mug = await getStock(payload, await product('Speckled mug'))
    expect(mug.Oat).toMatchObject({ available: 12, state: 'in', label: '' })
    expect(mug.Cobalt).toMatchObject({ available: 3, state: 'low', label: 'Only 3 left' })
    expect((await getStock(payload, await product('Ochre serving plate')))['']).toMatchObject({
      state: 'low',
      label: 'Last one',
    })
    expect((await getStock(payload, await product('Kiln-door vase')))['']).toMatchObject({
      available: 0,
      state: 'out',
      label: 'Sold out',
    })
    expect((await getStock(payload, await product('Stoneware clay 5 kg')))[''].label).toBe(
      'Only 4 left',
    )
  })

  it('only accepts the visitor cookie format as a cart session', () => {
    const id = randomUUID()
    expect(toCartSession(id)).toBe(id)
    expect(toCartSession(id.toUpperCase())).toBe(id)
    for (const bad of [undefined, null, '', '1', `${id}x`, "' OR 1=1 --", 'a'.repeat(500)]) {
      expect(toCartSession(bad)).toBeNull()
    }
  })

  it('keeps each session to its own cart and prices lines on the server', async () => {
    const alice = randomUUID()
    const bob = randomUUID()
    const mug = await product('Speckled mug')
    const bowl = await product('Breakfast bowl')

    await addToCart(payload, alice, { productId: String(mug.id), variant: 'Cobalt', quantity: '2' })
    await addToCart(payload, alice, { productId: mug.id, variant: 'Oat', quantity: 1 })
    await addToCart(payload, alice, { productId: mug.id, variant: 'Cobalt', quantity: 1 })
    await addToCart(payload, bob, { productId: bowl.id, quantity: 1 })

    const cart = await getCartView(payload, alice)
    expect(cart.lines.map((l) => [l.variant, l.quantity, l.unitPrice, l.total])).toEqual([
      ['Cobalt', 3, 3200, 9600],
      ['Oat', 1, 2800, 2800],
    ])
    expect(cart).toMatchObject({ subtotal: 12400, count: 4, blocked: false })
    expect(await getCartCount(payload, alice)).toBe(4)
    expect(await getCartCount(payload, bob)).toBe(1)
    expect(await getCartCount(payload, randomUUID())).toBe(0)

    // Bob cannot change a line that is only in Alice's cart, whatever product he names.
    await expect(
      setCartLineQuantity(payload, bob, { productId: mug.id, variant: 'Oat', quantity: 0 }),
    ).rejects.toThrow('not in your cart')
    expect((await getCartView(payload, alice)).count).toBe(4)

    await setCartLineQuantity(payload, alice, { productId: mug.id, variant: 'Oat', quantity: 0 })
    await setCartLineQuantity(payload, alice, { productId: mug.id, variant: 'Cobalt', quantity: 1 })
    expect(await getCartView(payload, alice)).toMatchObject({ subtotal: 3200, count: 1 })

    // Guest carts are not readable through the API, also not by a signed-in member.
    const asMember = await payload.find({ collection: 'carts', user: mara, overrideAccess: false })
    expect(asMember.totalDocs).toBe(0)
  })

  it('rejects quantities, variants and products a visitor should not be able to order', async () => {
    const session = randomUUID()
    const mug = await product('Speckled mug')
    const bowl = await product('Breakfast bowl')
    const draft = await product('Raku tea bowl (draft)')
    const add = (input: Parameters<typeof addToCart>[2]) => addToCart(payload, session, input)

    for (const quantity of [0, -1, '1.5', 'abc', '', null, MAX_LINE_QUANTITY + 1, '1e3']) {
      await expect(add({ productId: bowl.id, quantity })).rejects.toBeInstanceOf(ShopError)
    }
    await expect(add({ productId: mug.id, quantity: 1 })).rejects.toThrow('Choose a glaze')
    await expect(add({ productId: mug.id, variant: 'Gold', quantity: 1 })).rejects.toThrow(
      'Choose a glaze',
    )
    await expect(add({ productId: bowl.id, variant: 'Oat', quantity: 1 })).rejects.toThrow(
      'does not exist',
    )
    await expect(add({ productId: draft.id, quantity: 1 })).rejects.toThrow('no longer for sale')
    await expect(add({ productId: 999_999, quantity: 1 })).rejects.toThrow('no longer for sale')
    await expect(add({ productId: '1; DROP', quantity: 1 })).rejects.toThrow('no longer for sale')

    // The cap counts what is already in the cart.
    await add({ productId: bowl.id, quantity: 6 })
    await expect(add({ productId: bowl.id, quantity: 5 })).rejects.toThrow(
      `up to ${MAX_LINE_QUANTITY}`,
    )
    await expect(
      setCartLineQuantity(payload, session, { productId: bowl.id, quantity: 11 }),
    ).rejects.toThrow(`up to ${MAX_LINE_QUANTITY}`)
    expect((await getCartView(payload, session)).count).toBe(6)
  })

  it('refuses sold-out products and more units than are in stock', async () => {
    const session = randomUUID()
    const vase = await product('Kiln-door vase')
    const mug = await product('Speckled mug')
    const plate = await product('Ochre serving plate')

    await expect(addToCart(payload, session, { productId: vase.id, quantity: 1 })).rejects.toThrow(
      'Kiln-door vase is sold out',
    )
    await expect(
      addToCart(payload, session, { productId: mug.id, variant: 'Cobalt', quantity: 4 }),
    ).rejects.toThrow('Only 3 left of Speckled mug in Cobalt')
    await addToCart(payload, session, { productId: plate.id, quantity: 1 })
    await expect(addToCart(payload, session, { productId: plate.id, quantity: 1 })).rejects.toThrow(
      'Only 1 left',
    )

    // Someone else buys the last plate first: the cart shows the problem and the order is refused.
    const other = randomUUID()
    await addToCart(payload, other, { productId: plate.id, quantity: 1 })
    await orderFromCart(other)
    const cart = await getCartView(payload, session)
    expect(cart.blocked).toBe(true)
    expect(cart.lines[0].problem).toBe('Sold out')
    await expect(orderFromCart(session)).rejects.toThrow('Not enough stock')
    expect((await product('Ochre serving plate')).inventory?.quantity).toBe(0)
  })

  it('quotes shipping, VAT and coupons, and the order gets the same amounts', async () => {
    const session = randomUUID()
    const mug = await product('Speckled mug')
    const tools = await product('Trimming tool set')
    await addToCart(payload, session, { productId: mug.id, variant: 'Celadon', quantity: 2 })

    // Two mugs: €56, under the free-shipping threshold.
    const plain = await quoteCart(payload, await getCartView(payload, session))
    expect(plain).toMatchObject({
      subtotal: 5600,
      discount: 0,
      shipping: SHIPPING_FLAT,
      total: 5600 + SHIPPING_FLAT,
    })
    expect(plain.vat).toBe(includedVat(6295))
    expect(plain.vat).toBe(1093)

    const cart = await getCartView(payload, session)
    const welcome = await quoteCart(payload, cart, { couponCode: ' welcome10 ' })
    expect(welcome).toMatchObject({ discount: 560, shipping: SHIPPING_FLAT, total: 5735 })
    expect(welcome.coupon).toEqual({ code: 'WELCOME10', freeShipping: false })

    const freeship = await quoteCart(payload, cart, { couponCode: 'FREESHIP' })
    expect(freeship).toMatchObject({ discount: 0, shipping: 0, total: 5600 })

    // STUDIO5 works once per customer, which the plugin cannot count for a guest: it refuses
    // the code and the shop asks the guest to sign in.
    expect((await quoteCart(payload, cart, { couponCode: 'STUDIO5' })).couponError).toBe(
      'Sign in to use this code: it works once per customer.',
    )
    expect(await quoteCart(payload, cart, { couponCode: 'STUDIO5', user: mara })).toMatchObject({
      discount: 500,
      total: 5100 + SHIPPING_FLAT,
    })
    for (const code of ['NOPE', 'x'.repeat(41), '<script>']) {
      const quote = await quoteCart(payload, cart, { couponCode: code })
      expect(quote).toMatchObject({ discount: 0, total: plain.total, coupon: undefined })
      expect(quote.couponError).toBe('We don’t know that code.')
    }

    // The order is created from the cart with the code, not with the quoted numbers.
    const order = await orderFromCart(session, { couponCode: 'WELCOME10' })
    expect(order).toMatchObject({
      subtotal: 5600,
      discount: 560,
      shipping: SHIPPING_FLAT,
      tax: 0,
      total: 5735,
      status: 'pending',
      paymentStatus: 'pending',
      customerEmail: 'guest@kiln.test',
    })
    expect(order.user ?? null).toBeNull()
    expect(order.items).toMatchObject([{ variant: 'Celadon', quantity: 2, price: 2800 }])
    expect(variantStock(await product('Speckled mug'), 'Celadon')).toBe(6)
    expect((await getCartView(payload, session)).count).toBe(0)

    // Free shipping from €75, and a free-shipping coupon on a small order.
    const big = randomUUID()
    await addToCart(payload, big, { productId: mug.id, variant: 'Oat', quantity: 2 })
    await addToCart(payload, big, { productId: tools.id, quantity: 1 })
    const bigCart = await getCartView(payload, big)
    expect(bigCart.subtotal).toBeGreaterThanOrEqual(FREE_SHIPPING_FROM)
    expect(await quoteCart(payload, bigCart)).toMatchObject({ shipping: 0, total: 8050 })
    expect((await orderFromCart(big)).total).toBe(8050)

    const small = randomUUID()
    await addToCart(payload, small, { productId: tools.id, quantity: 1 })
    const shipped = await orderFromCart(small, { couponCode: 'FREESHIP' })
    expect(shipped).toMatchObject({ subtotal: 2450, shipping: 0, total: 2450 })
  })

  it('counts a once-per-customer coupon per member and explains a minimum', async () => {
    const tools = await product('Trimming tool set')
    const bowl = await product('Breakfast bowl')
    const session = randomUUID()
    await addToCart(payload, session, { productId: tools.id, quantity: 1 })

    // €24.50 is under the €40 minimum.
    const low = await quoteCart(payload, await getCartView(payload, session), {
      couponCode: 'STUDIO5',
      user: mara,
    })
    expect(low.couponError).toBe('This code works from €40.')

    await addToCart(payload, session, { productId: bowl.id, quantity: 1 })
    const order = await orderFromCart(session, { couponCode: 'STUDIO5', user: mara })
    expect(order).toMatchObject({ subtotal: 5850, discount: 500, total: 5350 + SHIPPING_FLAT })
    expect(typeof order.user === 'object' ? order.user?.id : order.user).toBe(mara.id)

    await addToCart(payload, session, { productId: bowl.id, quantity: 2 })
    const cart = await getCartView(payload, session)
    expect(
      (await quoteCart(payload, cart, { couponCode: 'STUDIO5', user: mara })).couponError,
    ).toBe('You have already used this code.')
    expect(
      (await quoteCart(payload, cart, { couponCode: 'STUDIO5', user: jonas })).coupon,
    ).toBeDefined()
  })

  it('words every other coupon refusal from the reason the plugin gives', async () => {
    const session = randomUUID()
    const tools = await product('Trimming tool set')
    await addToCart(payload, session, { productId: tools.id, quantity: 1 })
    const cart = await getCartView(payload, session)
    const plain = await quoteCart(payload, cart)
    const HOUR = 3_600_000
    const refusals: Array<[Partial<Coupon> & { code: string }, string]> = [
      [{ code: 'PAUSED', status: 'inactive' }, 'This code can’t be used right now.'],
      [
        { code: 'NEXTYEAR', validFrom: new Date(Date.now() + HOUR).toISOString() },
        'This code isn’t valid yet.',
      ],
      [
        { code: 'LASTYEAR', validUntil: new Date(Date.now() - HOUR).toISOString() },
        'This code has expired.',
      ],
      [
        { code: 'ALLGONE', usageLimit: 1, usageCount: 1 },
        'This code has been used as often as it could be.',
      ],
      // A minimum that is not a round number of euros is shown to the cent.
      [{ code: 'BIGSPENDER', minPurchase: 12_550 }, 'This code works from €125.50.'],
      [
        { code: 'VASESONLY', appliesToProducts: [(await product('Kiln-door vase')).id] },
        'This code doesn’t apply to anything in your cart.',
      ],
    ]
    for (const [coupon, message] of refusals) {
      await payload.create({
        collection: 'coupons',
        data: { type: 'percentage', value: 10, status: 'active', ...coupon },
      })
      const quote = await quoteCart(payload, cart, { couponCode: coupon.code, user: mara })
      expect(quote.couponError, coupon.code).toBe(message)
      // A refused code changes nothing about the amounts.
      expect(quote).toMatchObject({ discount: 0, total: plain.total, coupon: undefined })
      await expect(
        placeOrder(payload, session, mara, { ...ADDRESS, couponCode: coupon.code }),
      ).rejects.toThrow(`Your discount code wasn’t applied. ${message}`)
    }
    await payload.delete({
      collection: 'coupons',
      where: { code: { in: refusals.map(([coupon]) => coupon.code) } },
    })
  })

  it('lets a member read their own orders only', async () => {
    const own = await payload.find({ collection: 'orders', user: mara, overrideAccess: false })
    expect(own.totalDocs).toBe(1)
    const other = await payload.find({ collection: 'orders', user: jonas, overrideAccess: false })
    expect(other.docs.some((o) => o.id === own.docs[0].id)).toBe(false)
    await expect(
      payload.findByID({
        collection: 'orders',
        id: own.docs[0].id,
        user: jonas,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'orders',
        id: own.docs[0].id,
        data: { status: 'delivered' },
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  describe('checkout', () => {
    it('validates the delivery form on the server', async () => {
      const session = randomUUID()
      await addToCart(payload, session, {
        productId: (await product('Breakfast bowl')).id,
        quantity: 1,
      })
      const attempt = (raw: Record<string, unknown>, user?: User) =>
        placeOrder(payload, session, user, raw).then(
          () => ({}),
          (error) =>
            (error as { fields?: Record<string, string> }).fields ?? { other: String(error) },
        )

      expect(Object.keys(await attempt({})).sort()).toEqual([
        'address1',
        'city',
        'country',
        'email',
        'firstName',
        'lastName',
        'postalCode',
      ])
      // A signed-in member needs no email; a guest needs a real one.
      expect(await attempt({ ...DELIVERY, email: 'not-an-email' })).toHaveProperty('email')
      expect(await attempt({ ...DELIVERY, country: 'US', email: 'g@kiln.test' })).toEqual({
        country: 'Choose one of the countries we ship to.',
      })
      expect(
        await attempt({
          ...DELIVERY,
          firstName: 'x'.repeat(81),
          postalCode: '<b>',
          email: 'g@kiln.test',
        }),
      ).toEqual({
        firstName: 'Keep your first name under 80 characters.',
        postalCode: 'That doesn’t look like a postcode.',
      })
      // Nothing was ordered by any of these.
      expect((await getCartView(payload, session)).count).toBe(1)
      await expect(placeOrder(payload, randomUUID(), mara, DELIVERY)).rejects.toThrow(
        'cart is empty',
      )
      await expect(
        placeOrder(payload, session, null, {
          ...DELIVERY,
          email: 'g@kiln.test',
          couponCode: 'NOPE',
        }),
      ).rejects.toThrow('discount code wasn’t applied')
    })

    it('lets a guest order, pay through the test provider and come back with the token', async () => {
      const session = randomUUID()
      const mug = await product('Speckled mug')
      const before = variantStock(mug, 'Oat')!
      await addToCart(payload, session, { productId: mug.id, variant: 'Oat', quantity: 2 })

      const { order, redirectTo } = await placeOrder(payload, session, null, {
        ...DELIVERY,
        email: ' Guus@Kiln.Test ',
        couponCode: 'welcome10',
        // Amounts in the form are ignored: the order is priced on the server.
        total: 1,
        subtotal: 1,
        shipping: 0,
        discount: 5599,
      })
      expect(redirectTo).toMatch(/^\/api\/payload-billing\/test\/payment\/test_pay_/)
      expect(order).toMatchObject({
        subtotal: 5600,
        discount: 560,
        shipping: SHIPPING_FLAT,
        total: 5735,
        status: 'pending',
        paymentStatus: 'pending',
        customerEmail: 'guus@kiln.test',
      })
      expect(order.user ?? null).toBeNull()
      expect(variantStock(await product('Speckled mug'), 'Oat')).toBe(before - 2)
      expect((await getCartView(payload, session)).count).toBe(0)

      const payment = await paymentOf(order)
      expect(payment).toMatchObject({ amount: 5735, currency: 'EUR', status: 'pending' })
      expect(payment.member ?? null).toBeNull()
      expect(payment.redirectUrl).toBe(orderPath(payload, order))
      const invoice = (await payload.findByID({
        collection: 'invoices',
        id: relId(payment.invoice) as number,
      })) as Invoice
      expect(invoice.customer ?? null).toBeNull()
      expect(invoice.customerInfo).toMatchObject({ name: 'Guus Gast', email: 'guus@kiln.test' })
      // The lines keep their normal prices; the coupon's discount is the invoice's own
      // discount, and the three add up to what the order costs.
      expect(invoice.items.map((i) => [i.description, i.quantity, i.unitAmount])).toEqual([
        ['Speckled mug (Oat)', 2, 2800],
        ['Shipping', 1, SHIPPING_FLAT],
      ])
      expect(invoice).toMatchObject({
        subtotal: 5600 + SHIPPING_FLAT,
        discountAmount: 560,
        taxAmount: 0,
        amount: 5735,
      })
      expect(invoice.amount).toBe(order.total)

      await settle(payment, 'instant-success')
      expect(await reload(order)).toMatchObject({
        status: 'processing',
        paymentStatus: 'paid',
        paymentMethod: 'test',
      })
      expect((await payload.findByID({ collection: 'invoices', id: invoice.id })).status).toBe(
        'paid',
      )

      // The order page: only with the token, as the member who placed it, or as an admin.
      const number = order.orderNumber!
      const token = orderToken(payload, number)
      const see = (opts: Parameters<typeof getOrderForVisitor>[2]) =>
        getOrderForVisitor(payload, number, opts)
      expect((await see({ token }))?.id).toBe(order.id)
      expect((await see({ user: ctx.admin }))?.id).toBe(order.id)
      for (const wrong of [
        undefined,
        '',
        token.slice(1),
        `${token}0`,
        orderToken(payload, 'ORD-1'),
      ]) {
        expect(await see({ token: wrong })).toBeNull()
      }
      expect(await see({ user: mara })).toBeNull()
      expect(await getOrderForVisitor(payload, 'ORD-0-000', { token })).toBeNull()
      expect(await getOrderForVisitor(payload, `${number}' OR 1=1`, { token })).toBeNull()
      // And never through the API.
      await expect(
        payload.findByID({ collection: 'orders', id: order.id, overrideAccess: false }),
      ).rejects.toThrow()
      const asMara = await payload.find({
        collection: 'payments',
        where: { order: { equals: order.id } },
        user: mara,
        overrideAccess: false,
      })
      expect(asMara.totalDocs).toBe(0)
    })

    it('ties a member’s order, payment and invoice to their account', async () => {
      const session = randomUUID()
      const bowl = await product('Breakfast bowl')
      await addToCart(payload, session, { productId: bowl.id, quantity: 1 })
      // The email in the form is ignored for a member.
      const { order } = await placeOrder(payload, session, jonas, {
        ...DELIVERY,
        email: 'x@evil.test',
      })
      expect(relId(order.user)).toBe(jonas.id)
      expect(order.customerEmail).toBe(jonas.email)
      expect(order.total).toBe(3400 + SHIPPING_FLAT)

      const payment = await paymentOf(order)
      expect(relId(payment.member)).toBe(jonas.id)
      const invoice = await payload.findByID({
        collection: 'invoices',
        id: relId(payment.invoice) as number,
        depth: 0,
      })
      expect(invoice.customer).toBe(jonas.id)
      expect(invoice.customerInfo).toMatchObject({ name: jonas.name, email: jonas.email })
      expect(invoice.items.map((i) => [i.description, i.quantity, i.unitAmount])).toEqual([
        ['Breakfast bowl', 1, 3400],
        ['Shipping', 1, SHIPPING_FLAT],
      ])
      await settle(payment, 'instant-success')

      const number = order.orderNumber!
      expect((await getOrderForVisitor(payload, number, { user: jonas }))?.id).toBe(order.id)
      expect(await getOrderForVisitor(payload, number, { user: mara })).toBeNull()
      const own = await payload.find({ collection: 'orders', user: jonas, overrideAccess: false })
      expect(own.docs.map((o) => o.id)).toContain(order.id)

      // The same browser, signed out again: the next order belongs to nobody.
      await addToCart(payload, session, { productId: bowl.id, quantity: 1 })
      const guest = await placeOrder(payload, session, null, { ...DELIVERY, email: 'g@kiln.test' })
      expect(guest.order.user ?? null).toBeNull()
      await settle(await paymentOf(guest.order), 'instant-success')
    })

    it('cancels the order and restocks when the payment fails, and can refill the cart', async () => {
      const session = randomUUID()
      const mug = await product('Speckled mug')
      const before = variantStock(mug, 'Cobalt')!
      const used = (await usageOf('FREESHIP')) ?? 0
      await addToCart(payload, session, { productId: mug.id, variant: 'Cobalt', quantity: 1 })
      const { order } = await placeOrder(payload, session, null, {
        ...DELIVERY,
        email: 'g@kiln.test',
        couponCode: 'FREESHIP',
      })
      expect(order).toMatchObject({ shipping: 0, total: 3200 })
      expect(variantStock(await product('Speckled mug'), 'Cobalt')).toBe(before - 1)
      expect(await usageOf('FREESHIP')).toBe(used + 1)

      await settle(await paymentOf(order), 'declined-payment')
      const cancelled = await payload.findByID({ collection: 'orders', id: order.id, depth: 1 })
      expect(cancelled).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' })
      expect(variantStock(await product('Speckled mug'), 'Cobalt')).toBe(before)
      expect(await usageOf('FREESHIP')).toBe(used)

      expect(await restoreCartFromOrder(payload, session, cancelled)).toBe(1)
      expect(await getCartView(payload, session)).toMatchObject({ count: 1, subtotal: 3200 })
      // Only a cancelled order can be put back.
      const paid = (
        await payload.find({
          collection: 'orders',
          where: { status: { equals: 'processing' } },
          depth: 1,
        })
      ).docs[0]
      await expect(restoreCartFromOrder(payload, session, paid)).rejects.toThrow('can’t be changed')
    })

    it('lets an admin refund an order, which restocks it', async () => {
      const session = randomUUID()
      const tools = await product('Trimming tool set')
      const before = tools.inventory!.quantity!
      await addToCart(payload, session, { productId: tools.id, quantity: 2 })
      const { order } = await placeOrder(payload, session, mara, DELIVERY)
      await settle(await paymentOf(order), 'instant-success')
      expect((await product('Trimming tool set')).inventory?.quantity).toBe(before - 2)

      const orders = payload.config.collections.find((c) => c.slug === 'orders')!
      const refund = (orders.endpoints || []).find((e) => e.path === '/:id/refund')!.handler
      const routeParams = { id: String(order.id) }
      expect((await refund(await request({ routeParams }))).status).toBe(403)
      expect((await refund(await request({ user: mara, routeParams }))).status).toBe(403)

      const res = await refund(await request({ user: ctx.admin, routeParams }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.refund.status).toBe('succeeded')
      expect(body.order).toEqual({ status: 'refunded', paymentStatus: 'refunded' })
      expect((await product('Trimming tool set')).inventory?.quantity).toBe(before)

      // Nothing is left to refund.
      expect((await refund(await request({ user: ctx.admin, routeParams }))).status).toBe(409)
      expect(
        (await refund(await request({ user: ctx.admin, routeParams: { id: '999999' } }))).status,
      ).toBe(404)
    })
  })

  describe('tie-ins', () => {
    const MINUTE = 60_000

    /** A paid order of one product, placed by `user` or by a guest. */
    const paidOrder = async (title: string, user?: User, variant?: string): Promise<Order> => {
      const session = randomUUID()
      await addToCart(payload, session, {
        productId: (await product(title)).id,
        variant,
        quantity: 1,
      })
      const { order } = await placeOrder(payload, session, user ?? null, {
        ...DELIVERY,
        email: 'guus@kiln.test',
      })
      await settle(await paymentOf(order), 'instant-success')
      return reload(order)
    }

    const confirmationsFor = async (order: Order) =>
      (
        await payload.find({
          collection: 'emails',
          where: {
            order: { equals: order.id },
            templateSlug: { equals: TEMPLATES.orderConfirmation },
          },
          depth: 0,
        })
      ).docs

    const shippedEmailsFor = async (order: Order) =>
      (
        await payload.find({
          collection: 'emails',
          where: {
            order: { equals: order.id },
            templateSlug: { equals: TEMPLATES.orderShipped },
          },
          depth: 0,
        })
      ).docs

    const runsOf = async (slug: string) =>
      (
        await payload.find({
          collection: 'workflow-runs',
          where: { 'workflow.slug': { equals: slug } },
          sort: '-createdAt',
          depth: 0,
          limit: 100,
        })
      ).docs

    const orderNotifications = async (order: Order, event?: string) =>
      (
        await payload.find({
          collection: 'notifications',
          where: {
            and: [
              { order: { equals: order.id } },
              ...(event ? [{ event: { equals: event } }] : [{ event: { exists: false } }]),
            ],
          },
          depth: 0,
        })
      ).docs

    it('emails the confirmation once when an order is paid, to guests too', async () => {
      const session = randomUUID()
      await addToCart(payload, session, {
        productId: (await product('Breakfast bowl')).id,
        quantity: 2,
      })
      const { order } = await placeOrder(payload, session, null, {
        ...DELIVERY,
        email: 'confirm-me@kiln.test',
        couponCode: 'WELCOME10',
      })
      // Nothing is sent while the order waits for its payment.
      expect(await confirmationsFor(order)).toHaveLength(0)

      await settle(await paymentOf(order), 'instant-success')
      const [email, ...more] = await confirmationsFor(order)
      expect(more).toHaveLength(0)
      expect(email).toMatchObject({ to: ['confirm-me@kiln.test'], priority: 1 })
      expect(email.subject).toBe(`Your Kiln & Co. order ${order.orderNumber}`)
      expect(email.recipient ?? null).toBeNull()

      await payload.jobs.run({ queue: MAIL_QUEUES.priority, limit: 100 })
      const { docs: delivered } = await payload.find({
        collection: MAIL_OUTBOX_SLUG,
        where: { to: { equals: 'confirm-me@kiln.test' } },
      })
      expect(delivered).toHaveLength(1)
      const html = delivered[0].html ?? ''
      expect(html).toContain('Thank you, Guus')
      expect(html).toContain('2 × Breakfast bowl')
      // 2 × €34 − 10% + €6.95 shipping.
      expect(html).toContain('€68.15')
      expect(html).toContain('€6.80 discount')
      expect(html).toContain('Guus Gast, Strandweg 12, 2042 AA Zandvoort')
      // The link lets a guest back in: it carries the order's token.
      expect(html).toContain(orderPath(payload, order).replace('&', '&amp;'))

      // Later changes to the order never send it again.
      await payload.update({ collection: 'orders', id: order.id, data: { status: 'shipped' } })
      await payload.update({ collection: 'orders', id: order.id, data: { paymentStatus: 'paid' } })
      expect(await confirmationsFor(order)).toHaveLength(1)
    })

    it('tells a member once when their order ships, in their inbox and by email', async () => {
      const order = await paidOrder('Breakfast bowl', jonas)
      expect((await confirmationsFor(order))[0]).toMatchObject({ to: [jonas.email] })
      expect(await orderNotifications(order, 'order-shipped')).toHaveLength(0)
      expect(await shippedEmailsFor(order)).toHaveLength(0)

      const ship = (status: Order['status']) =>
        payload.update({
          collection: 'orders',
          id: order.id,
          data: { status, trackingNumber: '3SKILN0042' },
        })
      await ship('shipped')
      await ship('delivered')
      await ship('shipped')
      const [shipped, ...more] = await orderNotifications(order, 'order-shipped')
      expect(more).toHaveLength(0)
      expect(shipped).toMatchObject({
        title: 'Your order has shipped',
        channel: 'orders',
        audience: 'user',
        recipient: jonas.id,
      })
      expect(JSON.stringify(shipped.message)).toContain(order.orderNumber)
      expect(JSON.stringify(shipped.message)).toContain('3SKILN0042')

      // Jonas sees it in his inbox; Mara does not.
      const inbox = (user: User) =>
        payload.find({
          collection: 'notifications',
          where: { order: { equals: order.id }, event: { equals: 'order-shipped' } },
          user,
          overrideAccess: false,
        })
      expect((await inbox(jonas)).totalDocs).toBe(1)
      expect((await inbox(mara)).totalDocs).toBe(0)

      // The email goes to members as well, like the confirmation, and also only once.
      const [email, ...moreEmails] = await shippedEmailsFor(order)
      expect(moreEmails).toHaveLength(0)
      expect(email).toMatchObject({ to: [jonas.email], recipient: jonas.id, priority: 1 })
    })

    it('emails a guest once when their order ships', async () => {
      const session = randomUUID()
      await addToCart(payload, session, {
        productId: (await product('Breakfast bowl')).id,
        quantity: 2,
      })
      const { order } = await placeOrder(payload, session, null, {
        ...DELIVERY,
        email: 'ship-to-me@kiln.test',
      })
      await settle(await paymentOf(order), 'instant-success')
      // Paying confirms the order; the shipped email waits for the status change.
      expect(await shippedEmailsFor(order)).toHaveLength(0)

      const save = (data: Partial<Order>) =>
        payload.update({ collection: 'orders', id: order.id, data })
      await save({ status: 'shipped', trackingNumber: '3SKILN0099' })
      const [email, ...more] = await shippedEmailsFor(order)
      expect(more).toHaveLength(0)
      expect(email).toMatchObject({ to: ['ship-to-me@kiln.test'], priority: 1 })
      expect(email.subject).toBe(`Your Kiln & Co. order ${order.orderNumber} has shipped`)
      expect(email.recipient ?? null).toBeNull()
      // A guest has no inbox, so the email is the only message.
      expect(await orderNotifications(order, 'order-shipped')).toHaveLength(0)

      // Saving the shipped order again, or moving it away and back, never sends a second one.
      await save({ status: 'shipped' })
      await save({ notes: 'Left with the neighbours' })
      await save({ status: 'delivered' })
      await save({ status: 'shipped' })
      expect(await shippedEmailsFor(order)).toHaveLength(1)

      await payload.jobs.run({ queue: MAIL_QUEUES.priority, limit: 100 })
      const { docs: delivered } = await payload.find({
        collection: MAIL_OUTBOX_SLUG,
        where: {
          to: { equals: 'ship-to-me@kiln.test' },
          subject: { contains: 'has shipped' },
        },
      })
      expect(delivered).toHaveLength(1)
      const html = delivered[0].html ?? ''
      expect(html).toContain('on its way, Guus')
      expect(html).toContain('2 × Breakfast bowl')
      expect(html).toContain('Tracking number: 3SKILN0099')
      expect(html).toContain('Guus Gast, Strandweg 12, 2042 AA Zandvoort')
      // The link lets a guest back in: it carries the order's token.
      expect(html).toContain(orderPath(payload, order).replace('&', '&amp;'))
    })

    it('ships an order even when the shipped email cannot be sent', async () => {
      const guestOrder = await paidOrder('Breakfast bowl')
      const memberOrder = await paidOrder('Breakfast bowl', jonas)
      // Without its template the email cannot be rendered, so every send throws.
      const { docs: templates } = await payload.find({
        collection: 'email-templates',
        where: { slug: { equals: TEMPLATES.orderShipped } },
      })
      expect(templates).toHaveLength(1)
      const renameTemplate = (slug: string) =>
        payload.update({ collection: 'email-templates', id: templates[0].id, data: { slug } })
      await renameTemplate('order-shipped-missing')
      const logged = vi.spyOn(payload.logger, 'error')
      try {
        for (const order of [guestOrder, memberOrder]) {
          const saved = await payload.update({
            collection: 'orders',
            id: order.id,
            data: { status: 'shipped' },
          })
          expect(saved.status).toBe('shipped')
          expect((await reload(order)).status).toBe('shipped')
          expect(await shippedEmailsFor(order)).toHaveLength(0)
        }
        expect(logged).toHaveBeenCalledTimes(2)
        expect(logged.mock.calls[0][0]).toMatchObject({
          msg: `Shipped email for order ${guestOrder.orderNumber} failed`,
        })
        // The member's inbox notification does not depend on the email.
        expect(await orderNotifications(memberOrder, 'order-shipped')).toHaveLength(1)
      } finally {
        logged.mockRestore()
        await renameTemplate(TEMPLATES.orderShipped)
      }

      // Nothing was recorded for the failed send, so shipping the order again does send it.
      await payload.update({
        collection: 'orders',
        id: guestOrder.id,
        data: { status: 'processing' },
      })
      await payload.update({ collection: 'orders', id: guestOrder.id, data: { status: 'shipped' } })
      expect(await shippedEmailsFor(guestOrder)).toHaveLength(1)
    })

    it('runs the "Shop order paid" workflow: a log entry, and a low-stock warning for the admin', async () => {
      const before = (await runsOf(WORKFLOW_SLUGS.orderPaid)).length
      // Clay is under its threshold (4 left of 5) and gets lower with this order.
      const order = await paidOrder('Stoneware clay 5 kg', mara)
      const left = (await product('Stoneware clay 5 kg')).inventory!.quantity!

      const runs = await runsOf(WORKFLOW_SLUGS.orderPaid)
      expect(runs).toHaveLength(before + 1)
      expect(runs[0].status).toBe('completed')
      expect(runs[0].stepResults?.map((step) => step.status)).toEqual(Array(4).fill('succeeded'))

      const { docs: log } = await payload.find({
        collection: 'studio-log',
        where: { source: { equals: 'order' } },
        sort: '-createdAt',
        limit: 1,
        overrideAccess: false,
      })
      expect(log[0]).toMatchObject({
        title: 'Shop order paid: 1 piece',
        message: 'Sold: Stoneware clay 5 kg. Low on stock now: Stoneware clay 5 kg.',
        severity: 'warning',
      })
      // The log is public: it never says who bought.
      expect(JSON.stringify(log[0])).not.toContain(order.orderNumber)

      const [warning, ...more] = await orderNotifications(order)
      expect(more).toHaveLength(0)
      expect(warning).toMatchObject({
        title: 'Low stock in the shop',
        channel: 'orders',
        recipient: ctx.admin.id,
      })
      expect(JSON.stringify(warning.message)).toContain(
        `After order ${order.orderNumber}: Stoneware clay 5 kg (${left} left).`,
      )

      // Plenty of bowls: a log entry, no warning. Shipping the order later runs nothing.
      const calm = await paidOrder('Breakfast bowl', mara)
      expect(await orderNotifications(calm)).toHaveLength(0)
      const latest = (await runsOf(WORKFLOW_SLUGS.orderPaid))[0]
      expect(latest.stepResults?.map((step) => step.status)).toEqual([
        'succeeded',
        'succeeded',
        'succeeded',
        'skipped',
      ])
      await payload.update({ collection: 'orders', id: calm.id, data: { status: 'shipped' } })
      expect(await runsOf(WORKFLOW_SLUGS.orderPaid)).toHaveLength(before + 2)
    })

    it('releases orders left unpaid, restocks them and voids what was open', async () => {
      // Earlier tests left unpaid orders behind; release those first so the numbers below are
      // only about this order.
      await cancelStaleOrders(payload, { now: new Date(Date.now() + 60 * MINUTE) })

      const session = randomUUID()
      const tools = await product('Trimming tool set')
      const stock = tools.inventory!.quantity!
      await addToCart(payload, session, { productId: tools.id, quantity: 3 })
      const { order } = await placeOrder(payload, session, mara, DELIVERY)
      const payment = await paymentOf(order)
      expect((await product('Trimming tool set')).inventory?.quantity).toBe(stock - 3)

      // Not yet: the order is younger than the limit.
      const soon = new Date(Date.now() + (STALE_ORDER_MINUTES - 1) * MINUTE)
      expect(await cancelStaleOrders(payload, { now: soon })).not.toContain(order.orderNumber)
      expect((await reload(order)).status).toBe('pending')

      const later = new Date(Date.now() + (STALE_ORDER_MINUTES + 1) * MINUTE)
      expect(await cancelStaleOrders(payload, { now: later })).toContain(order.orderNumber)
      expect(await reload(order)).toMatchObject({ status: 'cancelled' })
      expect((await product('Trimming tool set')).inventory?.quantity).toBe(stock)
      const cancelled = await payload.findByID({ collection: 'payments', id: payment.id, depth: 1 })
      expect(cancelled.status).toBe('canceled')
      expect((cancelled.invoice as Invoice).status).toBe('void')
      expect(await confirmationsFor(order)).toHaveLength(0)
      // Running it again finds nothing.
      expect(await cancelStaleOrders(payload, { now: later })).toEqual([])

      // Money that still arrives for the cancelled order goes straight back.
      await payload.update({
        collection: 'payments',
        id: payment.id,
        data: { status: 'succeeded' },
      })
      expect((await payload.findByID({ collection: 'payments', id: payment.id })).status).toBe(
        'refunded',
      )
      expect(await reload(order)).toMatchObject({ status: 'cancelled' })
      expect((await product('Trimming tool set')).inventory?.quantity).toBe(stock)
      expect(await confirmationsFor(order)).toHaveLength(0)
    })

    it('fires "Release unpaid orders" every minute and keeps only the runs that released something', async () => {
      const slug = WORKFLOW_SLUGS.releaseUnpaidOrders
      const workflow = async () =>
        (
          await payload.find({
            collection: 'workflows',
            where: { slug: { equals: slug } },
            depth: 1,
          })
        ).docs[0]
      /** Fires the trigger's next occurrence, like the scheduler job does a minute later. */
      const fireNext = async () => {
        const doc = await workflow()
        const trigger = doc.triggers![0] as { schedule: string; lastFiredAt: string }
        const occurrence = new Cron(trigger.schedule).nextRun(new Date(trigger.lastFiredAt))!
        const results = await runScheduledTriggers(payload, {
          now: new Date(occurrence.getTime() + MINUTE / 2),
        })
        return results.filter((r) => String(r.workflowId) === String(doc.id))
      }
      const releaseLog = async () =>
        (await payload.count({ collection: 'studio-log', where: { title: { like: 'Released' } } }))
          .totalDocs

      const seeded = await workflow()
      expect((seeded.triggers![0] as { schedule: string }).schedule).toBe('* * * * *')
      expect(RELEASE_UNPAID_ORDERS_SCHEDULE).toBe('* * * * *')
      expect(payload.config.jobs.tasks?.map((task) => task.slug)).toContain('cancel-stale-orders')

      const session = randomUUID()
      await addToCart(payload, session, {
        productId: (await product('Breakfast bowl')).id,
        quantity: 1,
      })
      const { order } = await placeOrder(payload, session, null, {
        ...DELIVERY,
        email: 'slow@kiln.test',
      })

      // A minute with nothing to release: every pending order is younger than the limit. The
      // workflow ran, but its run is not kept and nothing is logged.
      const runsBefore = (await runsOf(slug)).length
      const logBefore = await releaseLog()
      const idle = await fireNext()
      expect(idle).toMatchObject([{ status: 'triggered', discarded: true }])
      expect(await runsOf(slug)).toHaveLength(runsBefore)
      expect(
        await payload.findByID({
          collection: 'workflow-runs',
          id: idle[0].runId as number,
          disableErrors: true,
        }),
      ).toBeNull()
      expect(await releaseLog()).toBe(logBefore)
      expect((await reload(order)).status).toBe('pending')

      // Make the order look old instead of moving the clock: the step uses the real time.
      await payload.db.updateOne({
        collection: 'orders',
        id: order.id,
        data: {
          createdAt: new Date(Date.now() - (STALE_ORDER_MINUTES + 5) * MINUTE).toISOString(),
        },
      })
      const busy = await fireNext()
      expect(busy.map((r) => r.status)).toEqual(['triggered'])
      expect(busy[0].discarded).toBeFalsy()

      const runs = await runsOf(slug)
      expect(runs).toHaveLength(runsBefore + 1)
      expect(String(runs[0].id)).toBe(String(busy[0].runId))
      expect(runs[0].status).toBe('completed')
      expect(runs[0].stepResults?.map((step) => step.status)).toEqual(['succeeded', 'succeeded'])
      expect((await reload(order)).status).toBe('cancelled')
      const { docs: log } = await payload.find({
        collection: 'studio-log',
        where: { title: { like: 'Released' } },
        sort: '-createdAt',
        limit: 1,
      })
      expect(log[0]).toMatchObject({ title: 'Released 1 unpaid order', source: 'order' })

      // The next minute is idle again, and the run that released the order is still there.
      expect(await fireNext()).toMatchObject([{ status: 'triggered', discarded: true }])
      expect((await runsOf(slug)).map((run) => run.id)).toEqual(runs.map((run) => run.id))
    })

    it('shows the free-shipping banner only while its flag is on', async () => {
      const { default: ShopPage } = await import('@/app/(frontend)/shop/page')
      /** Whether the page's element tree holds an element with this test id. */
      const renders = async (testId: string): Promise<boolean> => {
        const seen = new Set<unknown>()
        const walk = (node: unknown): boolean => {
          if (!node || typeof node !== 'object' || seen.has(node)) return false
          seen.add(node)
          if (Array.isArray(node)) return node.some(walk)
          const props = (node as { props?: Record<string, unknown> }).props
          return !!props && (props['data-testid'] === testId || walk(props.children))
        }
        return walk(await ShopPage({ searchParams: Promise.resolve({}) }))
      }
      expect(await renders('shop-promo')).toBe(true)

      const flag = await payload.find({
        collection: FLAGS_SLUG,
        where: { name: { equals: 'shop-free-shipping-banner' } },
      })
      await payload.update({
        collection: FLAGS_SLUG,
        id: flag.docs[0].id,
        data: { enabled: false },
      })
      expect(await renders('shop-promo')).toBe(false)
      await payload.update({ collection: FLAGS_SLUG, id: flag.docs[0].id, data: { enabled: true } })
    })
  })

  it('hides the shop while the flag is off', async () => {
    const { default: ShopPage } = await import('@/app/(frontend)/shop/page')
    const render = () => ShopPage({ searchParams: Promise.resolve({}) })
    await expect(render()).resolves.toBeTruthy()

    const flag = await payload.find({ collection: FLAGS_SLUG, where: { name: { equals: 'shop' } } })
    await payload.update({ collection: FLAGS_SLUG, id: flag.docs[0].id, data: { enabled: false } })
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining('404') })
    await payload.update({ collection: FLAGS_SLUG, id: flag.docs[0].id, data: { enabled: true } })
  })
})
