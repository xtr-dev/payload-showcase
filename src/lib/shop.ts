import {
  isSameCartLine,
  resolveUnitPrice,
  // The plugin's server helpers are named like a React hook; the alias keeps the
  // react-hooks lint rule from treating these plain server functions as components.
  useEcommerce as ecommerceHelpers,
} from '@xtr-dev/payload-ecommerce'
import { sendEmail } from '@xtr-dev/payload-mailing'
import { createHmac, timingSafeEqual } from 'crypto'
import type { Payload, PayloadRequest } from 'payload'

import type {
  Cart,
  Category,
  Coupon,
  Email,
  Media,
  Notification,
  Order,
  Product,
  User,
} from '@/payload-types'
import { checkoutProvider } from '@/plugins/billing'

import { paymentLink, siteOrigin } from './checkout'
import { asMedia, formatPrice } from './format'
import { MAIL_QUEUES, siteUrl, TEMPLATES } from './mailing'
import { notifyMember } from './notifications'

/**
 * The studio shop's storefront logic, built on @xtr-dev/payload-ecommerce.
 *
 * The plugin's helpers bypass access control, because a guest cart belongs to nobody the API can
 * identify. Everything here therefore takes the visitor's cart session id (the httpOnly `kiln_vid`
 * cookie, see src/proxy.ts) and only ever loads the cart stored under it: a cart id, a price or a
 * total never comes from the browser. Product ids from the browser are read with the public access
 * rule, so only active products can be added.
 *
 * Checkout (`placeOrder`) creates the order from that cart with the plugin, which prices the lines
 * and applies the coupon itself, and then starts a payment through @xtr-dev/payload-billing. A
 * guest reaches their order afterwards with a signed token in the order page's URL.
 *
 * Once an order is paid its customer gets a confirmation email, a member is told in their inbox
 * when it ships, and orders left unpaid are cancelled by `cancelStaleOrders`; the hooks and the
 * workflow step that call these live in src/plugins/ecommerce.ts.
 *
 * Nothing here reads cookies or imports the Payload config, so the integration tests call these
 * functions directly; the server actions in src/components/shop/actions.ts are thin wrappers.
 */

/** Flat shipping rate in cents, VAT included. */
export const SHIPPING_FLAT = 695
/** Item subtotal in cents from which shipping is free. The coupon discount is not subtracted. */
export const FREE_SHIPPING_FROM = 7500
/** Dutch standard VAT rate in percent. Shop prices include it. */
export const VAT_RATE = 21
/** The most units of one product (and variant) a single cart may hold. */
export const MAX_LINE_QUANTITY = 10

/** Thrown for anything the visitor can fix; its message is shown in the form. */
export class ShopError extends Error {}

/**
 * Accepts the visitor cookie as a cart session id only when it looks like the UUID that
 * src/proxy.ts hands out, so an arbitrary cookie value is never stored or queried.
 */
export const toCartSession = (value: string | null | undefined): string | null =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null

/** A whole number from form input, or null when it is anything else (decimals, text, empty). */
const toInteger = (value: unknown): number | null => {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''
  return /^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null
}

export const shippingFor = (subtotal: number): number =>
  subtotal <= 0 || subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FLAT

/** The VAT that is part of a VAT-inclusive amount, in cents. */
export const includedVat = (total: number): number =>
  Math.round((total * VAT_RATE) / (100 + VAT_RATE))

export interface Stock {
  /** Units that can still be ordered; null when the product does not track stock. */
  available: number | null
  state: 'in' | 'low' | 'out'
  /** Short label for a badge; empty when there is nothing worth saying. */
  label: string
}

const describeStock = (available: number, lowStockThreshold: number): Stock => {
  if (!Number.isFinite(available)) return { available: null, state: 'in', label: '' }
  if (available <= 0) return { available: 0, state: 'out', label: 'Sold out' }
  if (available === 1) return { available, state: 'low', label: 'Last one' }
  if (available <= lowStockThreshold) {
    return { available, state: 'low', label: `Only ${available} left` }
  }
  return { available, state: 'in', label: '' }
}

/**
 * Stock per variant name of a product (the empty string for a product without variants), as the
 * plugin counts it: a variant with its own inventory number is counted on its own.
 */
export const getStock = async (
  payload: Payload,
  product: Product,
): Promise<Record<string, Stock>> => {
  const { products } = ecommerceHelpers(payload)
  const names = product.variants?.length ? product.variants.map((v) => v.name) : ['']
  const threshold = product.inventory?.lowStockThreshold ?? 0
  const entries = await Promise.all(
    names.map(async (name) => {
      const { quantity } = await products.checkInventory(product.id, 1, name || undefined)
      return [name, describeStock(quantity, threshold)] as const
    }),
  )
  return Object.fromEntries(entries)
}

/** One badge for the whole product: sold out only when every variant is. */
export const summariseStock = (stock: Record<string, Stock>): Stock => {
  const all = Object.values(stock)
  if (all.length === 1) return all[0]
  if (all.every((s) => s.state === 'out')) return { available: 0, state: 'out', label: 'Sold out' }
  return { available: null, state: 'in', label: '' }
}

/** The lowest price a product can be bought for, and whether variants differ from it. */
export const priceRange = (product: Product): { from: number; varies: boolean } => {
  const prices = product.variants?.length
    ? product.variants.map((v) => resolveUnitPrice(product, v.name))
    : [resolveUnitPrice(product)]
  const from = Math.min(...prices)
  return { from, varies: prices.some((p) => p !== from) }
}

export interface CartLine {
  /** Stable React key: product id plus variant name. */
  key: string
  product: Product
  variant: string | null
  quantity: number
  /** Price of one unit in cents, from the product (or its variant) as it is now. */
  unitPrice: number
  total: number
  image: Media | null
  stock: Stock
  /** Why this line cannot be ordered as it is; undefined when it can. */
  problem?: string
}

export interface CartView {
  /** The cart document's id; null while the visitor has no cart. */
  id: number | null
  lines: CartLine[]
  /** Sum of the line totals in cents. */
  subtotal: number
  /** Number of units over all lines. */
  count: number
  /** True when at least one line has a `problem`. */
  blocked: boolean
}

const EMPTY_CART: CartView = { id: null, lines: [], subtotal: 0, count: 0, blocked: false }

/**
 * The cart of this session with everything a page needs to show it. Prices and totals are worked
 * out here from the products, never taken from stored or submitted numbers. Lines whose product
 * was deleted are dropped from the cart, since they can be neither shown nor ordered.
 */
export const getCartView = async (payload: Payload, sessionId: string): Promise<CartView> => {
  const { cart: carts } = ecommerceHelpers(payload)
  const cart = (await carts.getCart(undefined, sessionId)) as Cart | null
  if (!cart?.items?.length) return cart ? { ...EMPTY_CART, id: cart.id } : EMPTY_CART

  const items = cart.items.filter((item) => item.product && typeof item.product === 'object')
  if (items.length !== cart.items.length) {
    await payload.update({
      collection: 'carts',
      id: cart.id,
      data: {
        items: items.map((item) => ({
          product: (item.product as Product).id,
          variant: item.variant,
          quantity: item.quantity,
        })),
      },
    })
  }

  const stockByProduct = new Map<number, Record<string, Stock>>()
  const lines: CartLine[] = []
  for (const item of items) {
    const product = item.product as Product
    const variant = item.variant || null
    if (!stockByProduct.has(product.id)) {
      stockByProduct.set(product.id, await getStock(payload, product))
    }
    const stock = stockByProduct.get(product.id)![variant ?? ''] ?? describeStock(0, 0)
    const unitPrice = resolveUnitPrice(product, variant)
    let problem: string | undefined
    if (product.status !== 'active') problem = 'No longer for sale'
    else if (stock.available !== null && stock.available < item.quantity) {
      problem = stock.available === 0 ? 'Sold out' : `Only ${stock.available} left`
    }
    lines.push({
      key: `${product.id}:${variant ?? ''}`,
      product,
      variant,
      quantity: item.quantity,
      unitPrice,
      total: unitPrice * item.quantity,
      image: asMedia(product.images?.[0]),
      stock,
      problem,
    })
  }
  return {
    id: cart.id,
    lines,
    subtotal: lines.reduce((sum, line) => sum + line.total, 0),
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    blocked: lines.some((line) => line.problem),
  }
}

/** Units in this session's cart, for the header. Reads the cart without loading its products. */
export const getCartCount = async (payload: Payload, sessionId: string): Promise<number> => {
  const { docs } = await payload.find({
    collection: 'carts',
    where: {
      and: [
        { sessionId: { equals: sessionId } },
        { expiresAt: { greater_than: new Date().toISOString() } },
      ],
    },
    sort: '-updatedAt',
    limit: 1,
    depth: 0,
  })
  return (docs[0]?.items ?? []).reduce((sum, item) => sum + item.quantity, 0)
}

export interface CartLineInput {
  productId: unknown
  variant?: unknown
  quantity: unknown
}

/**
 * Checks a product id and variant name that came from the browser. The product is read with the
 * public access rule, so drafts and archived products count as not found.
 */
const resolveLine = async (
  payload: Payload,
  input: CartLineInput,
): Promise<{ product: Product; variant: string | null }> => {
  const productId = toInteger(input.productId)
  const product = productId
    ? await payload.findByID({
        collection: 'products',
        id: productId,
        depth: 0,
        disableErrors: true,
        overrideAccess: false,
      })
    : null
  if (!product) throw new ShopError('That product is no longer for sale.')

  const variant = typeof input.variant === 'string' && input.variant ? input.variant : null
  const names = (product.variants ?? []).map((v) => v.name)
  if (names.length ? !variant || !names.includes(variant) : variant) {
    throw new ShopError(names.length ? 'Choose a glaze first.' : 'That option does not exist.')
  }
  return { product, variant }
}

/** Refuses a quantity the cart could never be ordered with. */
const assertOrderable = async (
  payload: Payload,
  product: Product,
  variant: string | null,
  quantity: number,
): Promise<void> => {
  if (quantity > MAX_LINE_QUANTITY) {
    throw new ShopError(`You can order up to ${MAX_LINE_QUANTITY} of one item.`)
  }
  const { products } = ecommerceHelpers(payload)
  const stock = await products.checkInventory(product.id, quantity, variant ?? undefined)
  if (!stock.available) {
    throw new ShopError(
      stock.quantity > 0
        ? `Only ${stock.quantity} left of ${product.title}${variant ? ` in ${variant}` : ''}.`
        : `${product.title}${variant ? ` in ${variant}` : ''} is sold out.`,
    )
  }
}

/** Adds units of a product to this session's cart, creating the cart when there is none. */
export const addToCart = async (
  payload: Payload,
  sessionId: string,
  input: CartLineInput,
): Promise<void> => {
  const quantity = toInteger(input.quantity)
  if (!quantity || quantity > MAX_LINE_QUANTITY) {
    throw new ShopError(`Choose a quantity between 1 and ${MAX_LINE_QUANTITY}.`)
  }
  const { product, variant } = await resolveLine(payload, input)

  const { cart: carts } = ecommerceHelpers(payload)
  const cart = (await carts.getCart(undefined, sessionId)) as Cart | null
  const inCart =
    cart?.items?.find((item) => isSameCartLine(item, product.id, variant))?.quantity ?? 0
  await assertOrderable(payload, product, variant, inCart + quantity)

  await carts.addToCart({
    productId: product.id,
    quantity,
    variant: variant ?? undefined,
    sessionId,
  })
}

/**
 * Sets the quantity of one line of this session's cart; 0 removes the line. The line has to be in
 * the visitor's own cart already, so this cannot be used to add products.
 */
export const setCartLineQuantity = async (
  payload: Payload,
  sessionId: string,
  input: CartLineInput,
): Promise<void> => {
  const quantity = toInteger(input.quantity)
  if (quantity === null) throw new ShopError('Enter a whole number.')
  const productId = toInteger(input.productId)
  const variant = typeof input.variant === 'string' && input.variant ? input.variant : null

  const { cart: carts } = ecommerceHelpers(payload)
  const cart = (await carts.getCart(undefined, sessionId)) as Cart | null
  const line = cart?.items?.find((item) => isSameCartLine(item, productId, variant))
  if (!cart || !line || !productId) throw new ShopError('That item is not in your cart.')

  if (quantity === 0) {
    await carts.removeFromCart({ cartId: cart.id, productId, variant })
    return
  }
  // Removing a product that is no longer for sale is always possible; changing its quantity is not.
  const { product } = await resolveLine(payload, { productId, variant, quantity })
  await assertOrderable(payload, product, variant, quantity)
  await carts.updateCartItem({ cartId: cart.id, productId, quantity, variant })
}

export interface Quote {
  subtotal: number
  /** Amount the coupon takes off the subtotal. */
  discount: number
  shipping: number
  /** What the customer pays: subtotal − discount + shipping. VAT is included. */
  total: number
  /** The VAT contained in `total`. */
  vat: number
  /** The applied coupon; undefined when no code was given or it was refused. */
  coupon?: { code: string; freeShipping: boolean }
  /** Why the given code was refused, in words for the customer. */
  couponError?: string
}

/** A coupon code as typed by a customer, tidied; null when it cannot be a code at all. */
export const normaliseCouponCode = (value: unknown): string | null => {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return /^[A-Z0-9_-]{1,40}$/.test(code) ? code : null
}

/**
 * What an order for this cart would cost, with an optional coupon code checked by the plugin for
 * this cart and customer. The order created at checkout runs the same coupon rules again, so a
 * quote is a preview and never the source of an order's amounts.
 *
 * The plugin enforces a coupon's per-customer limit by counting the customer's orders, which it
 * cannot do for a guest. Such a coupon is therefore only accepted from a signed-in member.
 */
export const quoteCart = async (
  payload: Payload,
  cart: Pick<CartView, 'lines' | 'subtotal'>,
  { couponCode, user }: { couponCode?: string | null; user?: Pick<User, 'id'> | null } = {},
): Promise<Quote> => {
  const { coupons, orders } = ecommerceHelpers(payload)
  const subtotal = cart.subtotal
  let shipping = shippingFor(subtotal)
  let discount = 0
  let coupon: Quote['coupon']
  let couponError: string | undefined

  if (couponCode) {
    const code = normaliseCouponCode(couponCode)
    const found = code ? ((await coupons.findCouponByCode(code)) as Coupon | null) : null
    if (!code || !found) {
      couponError = 'We don’t know that code.'
    } else if (found.customerLimit && !user) {
      couponError = 'Sign in to use this code: it works once per customer.'
    } else {
      const categoryIds = cart.lines.flatMap((line) =>
        (line.product.categories ?? []).map((c) => (typeof c === 'object' ? c.id : c)),
      )
      const result = await coupons.validateCoupon({
        code,
        cartTotal: subtotal,
        userId: user?.id,
        productIds: cart.lines.map((line) => line.product.id),
        categoryIds,
      })
      if (result.valid) {
        discount = result.discount
        if (result.freeShipping) shipping = 0
        coupon = { code, freeShipping: result.freeShipping }
      } else if (found.minPurchase && subtotal < found.minPurchase) {
        couponError = `This code works from ${formatPrice(found.minPurchase)}.`
      } else if (result.error === 'Customer usage limit reached') {
        couponError = 'You have already used this code.'
      } else {
        couponError = 'This code can’t be used right now.'
      }
    }
  }

  const total = orders.calculateTotal({ subtotal, discount, shipping, tax: 0 })
  return { subtotal, discount, shipping, total, vat: includedVat(total), coupon, couponError }
}

/** The shop's categories in the order they were created, for the filter on /shop. */
export const getShopCategories = async (payload: Payload): Promise<Category[]> => {
  const { docs } = await payload.find({
    collection: 'categories',
    sort: 'id',
    depth: 0,
    limit: 50,
    overrideAccess: false,
  })
  return docs
}

/** Where the shop ships to. The checkout form offers these and the server accepts no other. */
export const SHIPPING_COUNTRIES = [
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'DE', name: 'Germany' },
] as const

export type CheckoutField =
  'email' | 'firstName' | 'lastName' | 'address1' | 'address2' | 'postalCode' | 'city' | 'country'

export type CheckoutValues = Partial<Record<CheckoutField, string>>

/** A checkout form that was filled in wrongly; `fields` says which inputs and why. */
export class CheckoutError extends ShopError {
  constructor(public fields: CheckoutValues) {
    super('Check the marked fields.')
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Checks the checkout form. Everything is trimmed and length-limited here, on the server; the
 * form's own `required` and `maxLength` attributes are only a convenience. A signed-in member's
 * email comes from their account, never from the form.
 */
const validateCheckout = (
  raw: Record<string, unknown>,
  user: Pick<User, 'email'> | null | undefined,
): Required<Omit<CheckoutValues, 'address2'>> & { address2?: string } => {
  const errors: CheckoutValues = {}
  const required = (field: CheckoutField, label: string, max: number): string => {
    const value = text(raw[field])
    if (!value) errors[field] = `Enter your ${label}.`
    else if (value.length > max) errors[field] = `Keep your ${label} under ${max} characters.`
    return value
  }

  const email = user ? user.email : text(raw.email).toLowerCase()
  if (!user && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) {
    errors.email = 'Enter an email address we can send your confirmation to.'
  }
  const firstName = required('firstName', 'first name', 80)
  const lastName = required('lastName', 'last name', 80)
  const address1 = required('address1', 'street and house number', 120)
  const city = required('city', 'town or city', 80)
  const postalCode = required('postalCode', 'postcode', 12)
  if (postalCode && !errors.postalCode && !/^[A-Za-z0-9][A-Za-z0-9 -]+$/.test(postalCode)) {
    errors.postalCode = 'That doesn’t look like a postcode.'
  }
  const address2 = text(raw.address2)
  if (address2.length > 120) errors.address2 = 'Keep this under 120 characters.'
  const country = text(raw.country).toUpperCase()
  if (!SHIPPING_COUNTRIES.some((c) => c.code === country)) {
    errors.country = 'Choose one of the countries we ship to.'
  }

  if (Object.keys(errors).length > 0) throw new CheckoutError(errors)
  return {
    email,
    firstName,
    lastName,
    address1,
    city,
    postalCode,
    country,
    ...(address2 ? { address2 } : {}),
  }
}

/**
 * The token that lets whoever holds it see one order: an HMAC of the order number under the
 * Payload secret. It is put in the order page's URL (`/shop/orders/ORD-…?t=…`) for the customer
 * who placed the order, so a guest can come back to it, and it cannot be worked out from the
 * order number alone.
 */
export const orderToken = (payload: Payload, orderNumber: string): string =>
  createHmac('sha256', payload.secret)
    .update(`shop-order:${orderNumber}`)
    .digest('hex')
    .slice(0, 40)

const isOrderToken = (payload: Payload, orderNumber: string, token: unknown): boolean => {
  if (typeof token !== 'string' || !/^[0-9a-f]{40}$/.test(token)) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(orderToken(payload, orderNumber)))
}

/** The order page's path including its token. Only hand this to the order's own customer. */
export const orderPath = (payload: Payload, order: Pick<Order, 'orderNumber'>): string => {
  const number = order.orderNumber ?? ''
  return `/shop/orders/${encodeURIComponent(number)}?t=${orderToken(payload, number)}`
}

const relId = (value: unknown): number | undefined =>
  value && typeof value === 'object' ? (value as { id: number }).id : (value as number | undefined)

/**
 * The order with this number, but only for someone allowed to see it: the holder of its token,
 * the signed-in member who placed it, or an admin. Anyone else gets null, exactly as for an
 * order number that does not exist, so order numbers cannot be probed.
 */
export const getOrderForVisitor = async (
  payload: Payload,
  orderNumber: unknown,
  { token, user }: { token?: unknown; user?: Pick<User, 'id' | 'role'> | null },
): Promise<Order | null> => {
  if (typeof orderNumber !== 'string' || !/^[A-Za-z0-9-]{1,60}$/.test(orderNumber)) return null
  const { docs } = await payload.find({
    collection: 'orders',
    where: { orderNumber: { equals: orderNumber } },
    depth: 2,
    limit: 1,
  })
  const order = docs[0]
  if (!order) return null
  const allowed =
    isOrderToken(payload, orderNumber, token) ||
    (!!user && (user.role === 'admin' || relId(order.user) === user.id))
  return allowed ? order : null
}

/** "Speckled mug (Cobalt)" for an order line, from its populated product. */
export const orderLineLabel = (item: Order['items'][number]): string => {
  const title = typeof item.product === 'object' ? item.product.title : 'Item'
  return item.variant ? `${title} (${item.variant})` : title
}

/**
 * Invoice lines that add up to the order's total. Billing invoice lines cannot be negative, so
 * an order with a discount is invoiced as one goods line at the discounted amount, with the
 * items and the discount spelled out in its description. Amounts include VAT, like every invoice
 * on the site.
 */
const invoiceItems = (order: Order) => {
  const goods = order.items.map((item) => ({
    description: orderLineLabel(item),
    quantity: item.quantity,
    unitAmount: item.price,
  }))
  const discount = order.discount ?? 0
  const lines =
    discount > 0
      ? [
          {
            description: `${goods.map((g) => `${g.quantity} × ${g.description}`).join(', ')}, less ${formatPrice(discount)} discount`,
            quantity: 1,
            unitAmount: order.subtotal - discount,
          },
        ]
      : goods
  const shipping = order.shipping ?? 0
  return shipping > 0
    ? [...lines, { description: 'Shipping', quantity: 1, unitAmount: shipping }]
    : lines
}

/**
 * Starts the payment for a freshly placed order: an open invoice (for the member, or for a guest
 * under the name and email they gave) and a payment linked to it and to the order. Creating the
 * payment makes the billing plugin ask the provider for a checkout. After paying, the provider
 * sends the customer to the order page, and the payment's status change marks the order paid or
 * cancels it; see `syncOrder` in src/plugins/ecommerce.ts.
 */
export const beginOrderCheckout = async ({
  payload,
  order: placed,
  user,
}: {
  payload: Payload
  order: Pick<Order, 'id'>
  user?: Pick<User, 'id'> | null
}): Promise<{ redirectTo: string }> => {
  const order = await payload.findByID({ collection: 'orders', id: placed.id, depth: 1 })
  const page = orderPath(payload, order)

  // Nothing to pay (a coupon covered everything): payments must be at least one cent.
  if (!order.total) {
    await payload.update({
      collection: 'orders',
      id: order.id,
      data: { status: 'processing', paymentStatus: 'paid' },
    })
    return { redirectTo: page }
  }

  const address = order.shippingAddress
  const invoice = await payload.create({
    collection: 'invoices',
    data: {
      customer: user?.id,
      // A member's name and email are filled in from their account (src/plugins/billing.ts).
      customerInfo: user
        ? undefined
        : { name: `${address?.firstName} ${address?.lastName}`, email: order.customerEmail },
      currency: 'EUR',
      status: 'open',
      items: invoiceItems(order),
      notes: `Shop order ${order.orderNumber}`,
      metadata: { order: order.orderNumber },
    },
  })
  const provider = checkoutProvider()
  const payment = await payload.create({
    collection: 'payments',
    data: {
      provider,
      status: 'pending',
      amount: order.total,
      currency: 'EUR',
      description: `Shop order ${order.orderNumber}`,
      invoice: invoice.id,
      member: user?.id,
      order: order.id,
      // The test provider redirects from a page on this site, so a path works on any host and
      // port; other providers need an absolute URL.
      redirectUrl: provider === 'test' ? page : `${siteOrigin()}${page}`,
      metadata: { invoice: invoice.number, order: order.orderNumber },
    },
  })
  await payload.update({
    collection: 'invoices',
    id: invoice.id,
    data: { payment: payment.id },
  })
  return { redirectTo: paymentLink(payment) }
}

/**
 * Checkout: turns this session's cart into an order and starts its payment.
 *
 * The browser supplies an address, an email (guests only) and optionally a coupon code; nothing
 * else. The cart is the one stored under the session, the lines are priced by the plugin from the
 * products, shipping is worked out here, and the coupon is validated and applied by the plugin
 * when it creates the order. Creating the order takes the stock, so an order that turns out to be
 * unpayable is cancelled again to release it.
 */
export const placeOrder = async (
  payload: Payload,
  sessionId: string,
  user: Pick<User, 'id' | 'email'> | null | undefined,
  raw: Record<string, unknown>,
): Promise<{ order: Order; redirectTo: string }> => {
  const form = validateCheckout(raw, user)
  const cart = await getCartView(payload, sessionId)
  if (!cart.id || cart.lines.length === 0) throw new ShopError('Your cart is empty.')
  if (cart.blocked) {
    throw new ShopError('Some items in your cart can’t be ordered any more. Check your cart.')
  }

  const couponCode = text(raw.couponCode)
  const quote = await quoteCart(payload, cart, { couponCode, user })
  if (quote.couponError)
    throw new ShopError(`Your discount code wasn’t applied. ${quote.couponError}`)

  // The plugin copies the cart's user to the order. The cart belongs to the browser, so it is set
  // on every checkout: to the member who is signed in now, or to nobody.
  await payload.update({
    collection: 'carts',
    id: cart.id,
    data: { user: user?.id ?? null },
  })

  const { orders } = ecommerceHelpers(payload)
  let order: Order
  try {
    order = (await orders.createOrderFromCart({
      cartId: cart.id,
      orderData: {
        customerEmail: form.email,
        shippingAddress: {
          firstName: form.firstName,
          lastName: form.lastName,
          address1: form.address1,
          address2: form.address2,
          postalCode: form.postalCode,
          city: form.city,
          country: form.country,
        },
        shipping: shippingFor(cart.subtotal),
        couponCode: quote.coupon?.code,
        paymentMethod: checkoutProvider(),
      },
    })) as Order
  } catch (error) {
    // The plugin's own refusals (someone else just bought the last one, the coupon ran out) are
    // written for customers; anything else is logged and kept vague.
    const reason = error instanceof Error ? error.message : ''
    if (/^Not enough stock|^Coupon/.test(reason)) {
      throw new ShopError(`${reason}. Check your cart and try again.`)
    }
    payload.logger.error({ err: error }, 'Shop order could not be created')
    throw new ShopError('We couldn’t place your order. Please try again.')
  }

  try {
    const { redirectTo } = await beginOrderCheckout({ payload, order, user })
    return { order, redirectTo }
  } catch (error) {
    payload.logger.error({ err: error }, `Payment for order ${order.orderNumber} could not start`)
    await orders.updateOrderStatus({ orderId: order.id, status: 'cancelled' })
    throw new ShopError('We couldn’t start the payment, so nothing was ordered or charged.')
  }
}

/**
 * Puts the lines of a cancelled order back into this session's cart, for a customer whose payment
 * did not go through. Lines that are no longer for sale or in stock are skipped; the number of
 * lines that made it is returned.
 */
export const restoreCartFromOrder = async (
  payload: Payload,
  sessionId: string,
  order: Order,
): Promise<number> => {
  if (order.status !== 'cancelled') throw new ShopError('This order can’t be changed any more.')
  let restored = 0
  for (const item of order.items) {
    try {
      await addToCart(payload, sessionId, {
        productId: relId(item.product),
        variant: item.variant,
        quantity: item.quantity,
      })
      restored += 1
    } catch (error) {
      if (!(error instanceof ShopError)) throw error
    }
  }
  return restored
}

/**
 * Sends the order confirmation, rendered from the `order-confirmation` template, to the email on
 * the order (the member's, or the one a guest gave at checkout). The link in it carries the
 * order's token. Goes out on the priority mail queue, like booking confirmations. Returns the
 * queued `emails` document.
 */
export const sendOrderConfirmation = async (
  payload: Payload,
  order: Order | number,
  { processImmediately = false }: { processImmediately?: boolean } = {},
): Promise<Email> => {
  const doc = await payload.findByID({
    collection: 'orders',
    id: typeof order === 'number' ? order : order.id,
    depth: 1,
  })
  if (!doc.customerEmail || !doc.orderNumber) {
    throw new Error(`Order ${doc.id} has no email address to confirm to`)
  }
  const address = doc.shippingAddress
  return sendEmail<Email>(payload, {
    template: {
      slug: TEMPLATES.orderConfirmation,
      variables: {
        siteUrl: siteUrl(),
        preheader: `Order ${doc.orderNumber} is paid. We are wrapping it now.`,
        firstName: address?.firstName ?? 'there',
        orderNumber: doc.orderNumber,
        orderToken: orderToken(payload, doc.orderNumber),
        items: doc.items.map((item) => `${item.quantity} × ${orderLineLabel(item)}`).join(', '),
        // In euros: the template formats them with the plugin's `formatCurrency` filter.
        shipping: (doc.shipping ?? 0) / 100,
        discount: (doc.discount ?? 0) / 100,
        total: doc.total / 100,
        shipTo: [
          `${address?.firstName} ${address?.lastName}`,
          address?.address1,
          `${address?.postalCode} ${address?.city}`,
        ].join(', '),
      },
    },
    data: {
      to: [doc.customerEmail],
      priority: 1,
      order: doc.id,
      recipient: relId(doc.user),
    },
    queue: MAIL_QUEUES.priority,
    processImmediately,
  })
}

/**
 * Tells the member who placed an order that it has shipped, on the Orders channel. Sent at most
 * once per order, also when an admin moves it back and to "shipped" again. Guests have no inbox,
 * so a guest order sends nothing. Returns the notification, or null when nothing was sent.
 */
export const notifyOrderShipped = async (
  payload: Payload,
  order: Order,
  { req }: { req?: PayloadRequest } = {},
): Promise<Notification | null> => {
  const memberId = relId(order.user)
  if (order.status !== 'shipped' || !memberId) return null
  const { totalDocs } = await payload.count({
    collection: 'notifications',
    where: { and: [{ order: { equals: order.id } }, { event: { equals: 'order-shipped' } }] },
    req,
  })
  if (totalDocs > 0) return null
  return notifyMember(payload, memberId, {
    channel: 'orders',
    order: order.id,
    event: 'order-shipped',
    title: 'Your order has shipped',
    message: `Order ${order.orderNumber} left the studio today${order.trackingNumber ? ` (tracking ${order.trackingNumber})` : ''}. Unwrap it carefully: there is a lot of paper.`,
    req,
  })
}

/** How long an order may wait for its payment before `cancelStaleOrders` releases it. */
export const STALE_ORDER_MINUTES = 30

/**
 * Cancels orders that were placed more than `olderThanMinutes` ago and never paid, so the stock
 * they hold goes back on sale (the plugin restocks a cancelled order and gives its coupon use
 * back). Their pending payments are marked cancelled too, which stops "Pay now" from being
 * offered for them. An order whose payment the provider is still processing is left alone.
 * Returns the numbers of the orders it cancelled.
 */
export const cancelStaleOrders = async (
  payload: Payload,
  { olderThanMinutes = STALE_ORDER_MINUTES, now = new Date() } = {},
): Promise<string[]> => {
  const { orders } = ecommerceHelpers(payload)
  const { docs } = await payload.find({
    collection: 'orders',
    where: {
      and: [
        { status: { equals: 'pending' } },
        { paymentStatus: { equals: 'pending' } },
        {
          createdAt: {
            less_than: new Date(now.getTime() - olderThanMinutes * 60_000).toISOString(),
          },
        },
      ],
    },
    sort: 'createdAt',
    limit: 50,
    depth: 0,
  })
  const cancelled: string[] = []
  for (const order of docs) {
    const { docs: payments } = await payload.find({
      collection: 'payments',
      where: {
        and: [{ order: { equals: order.id } }, { status: { in: ['pending', 'processing'] } }],
      },
      depth: 0,
      limit: 10,
    })
    if (payments.some((payment) => payment.status === 'processing')) continue
    await orders.updateOrderStatus({ orderId: order.id, status: 'cancelled' })
    for (const payment of payments) {
      await payload.update({
        collection: 'payments',
        id: payment.id,
        data: { status: 'canceled' },
      })
    }
    cancelled.push(order.orderNumber ?? String(order.id))
  }
  return cancelled
}
