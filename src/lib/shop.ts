import {
  isSameCartLine,
  resolveUnitPrice,
  // The plugin's server helpers are named like a React hook; the alias keeps the
  // react-hooks lint rule from treating these plain server functions as components.
  useEcommerce as ecommerceHelpers,
} from '@xtr-dev/payload-ecommerce'
import type { Payload } from 'payload'

import type { Cart, Category, Coupon, Media, Product, User } from '@/payload-types'

import { asMedia, formatPrice } from './format'

/**
 * The studio shop's storefront logic, built on @xtr-dev/payload-ecommerce.
 *
 * The plugin's helpers bypass access control, because a guest cart belongs to nobody the API can
 * identify. Everything here therefore takes the visitor's cart session id (the httpOnly `kiln_vid`
 * cookie, see src/proxy.ts) and only ever loads the cart stored under it: a cart id, a price or a
 * total never comes from the browser. Product ids from the browser are read with the public access
 * rule, so only active products can be added.
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
