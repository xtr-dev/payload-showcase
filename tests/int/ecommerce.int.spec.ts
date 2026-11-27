import { useEcommerce as ecommerceHelpers } from '@xtr-dev/payload-ecommerce'
import { randomUUID } from 'crypto'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FLAGS_SLUG } from '@/lib/experiments'
import {
  addToCart,
  FREE_SHIPPING_FROM,
  getCartCount,
  getCartView,
  getStock,
  includedVat,
  MAX_LINE_QUANTITY,
  quoteCart,
  setCartLineQuantity,
  SHIPPING_FLAT,
  shippingFor,
  ShopError,
  toCartSession,
} from '@/lib/shop'
import type { Order, Product, User } from '@/payload-types'
import { seed, type SeedContext } from '@/seed'
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
const placeOrder = async (
  sessionId: string,
  { couponCode, user }: { couponCode?: string; user?: User } = {},
): Promise<Order> => {
  const cart = await getCartView(payload, sessionId)
  const quote = await quoteCart(payload, cart, { couponCode, user })
  if (user) await payload.update({ collection: 'carts', id: cart.id!, data: { user: user.id } })
  return (await ecommerceHelpers(payload).orders.createOrderFromCart({
    cartId: cart.id!,
    orderData: {
      shippingAddress: ADDRESS,
      customerEmail: user?.email ?? 'guest@kiln.test',
      shipping: shippingFor(cart.subtotal),
      couponCode: quote.coupon?.code,
    },
  })) as Order
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
    await placeOrder(other)
    const cart = await getCartView(payload, session)
    expect(cart.blocked).toBe(true)
    expect(cart.lines[0].problem).toBe('Sold out')
    await expect(placeOrder(session)).rejects.toThrow('Not enough stock')
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

    // STUDIO5 works once per customer, so a guest is asked to sign in.
    expect((await quoteCart(payload, cart, { couponCode: 'STUDIO5' })).couponError).toMatch(
      /Sign in/,
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
    const order = await placeOrder(session, { couponCode: 'WELCOME10' })
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
    expect((await placeOrder(big)).total).toBe(8050)

    const small = randomUUID()
    await addToCart(payload, small, { productId: tools.id, quantity: 1 })
    const shipped = await placeOrder(small, { couponCode: 'FREESHIP' })
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
    const order = await placeOrder(session, { couponCode: 'STUDIO5', user: mara })
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

  it('lets a member read their own orders only', async () => {
    const own = await payload.find({ collection: 'orders', user: mara, overrideAccess: false })
    expect(own.totalDocs).toBe(1)
    const other = await payload.find({ collection: 'orders', user: jonas, overrideAccess: false })
    expect(other.totalDocs).toBe(0)
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
