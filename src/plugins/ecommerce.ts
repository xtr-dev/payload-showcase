import { refundPayment } from '@xtr-dev/payload-billing'
import { payloadEcommerce, type CollectionExtender } from '@xtr-dev/payload-ecommerce'
import type { CollectionAfterChangeHook, Endpoint, Plugin } from 'payload'

import { getUser, isAdminUser } from '@/access'
import type { Order, Payment } from '@/payload-types'

import { SKIP_BILLING_SYNC } from './billing'
import { extendCollection } from './utils'

/**
 * @xtr-dev/payload-ecommerce
 *
 * The studio shop: products with variants and stock, categories, carts, coupons and orders.
 *
 * - Prices are integer cents including VAT, like every other amount on the site, so the plugin
 *   rounds with `Math.round` and no `calculateTax` hook is set: an order's `tax` stays 0 and its
 *   total is what the customer pays.
 * - Access is the plugin's default, with the site's own admin check: everyone reads active
 *   products and categories, coupons are admin-only, a member reads their own orders, and guest
 *   carts and orders are reachable only from server code. The storefront therefore goes through
 *   src/lib/shop.ts, which only ever uses the cart of the visitor's own session cookie.
 * - Each collection is extended with a function rather than edited afterwards, because the plugin
 *   builds its collections twice; the functions below only return new objects.
 * - Orders are paid through @xtr-dev/payload-billing: payments get an `order` relationship, and a
 *   payment's status changes drive the order (`pending → processing`, `cancelled` when the payment
 *   fails, `refunded` on a full refund). The plugin puts stock and the coupon use back whenever an
 *   order becomes cancelled or refunded.
 */

const relId = (value: unknown): number | undefined => {
  if (value && typeof value === 'object' && 'id' in value) return (value as { id: number }).id
  return typeof value === 'number' ? value : undefined
}

/** Puts a plugin collection under "Shop" in the admin navigation. */
const inShopGroup: CollectionExtender = (collection) => ({
  ...collection,
  admin: { ...collection.admin, group: 'Shop' },
})

/** Products get a one-line `summary`, shown on the shop's product cards and as meta description. */
const extendProducts: CollectionExtender = (collection) => {
  const [title, ...rest] = collection.fields
  return {
    ...inShopGroup(collection),
    fields: [
      title,
      {
        name: 'summary',
        type: 'textarea',
        maxLength: 200,
        admin: { description: 'One or two sentences for the product card.' },
      },
      ...rest,
    ],
  }
}

/**
 * `POST /api/orders/:id/refund` (admins only): refunds the order's payment in full through its
 * provider. The payment then becomes `refunded`, which marks the order refunded (see `syncOrder`)
 * and makes the plugin put the stock and the coupon use back. Used by the "Refund order" button
 * in the order's admin sidebar.
 */
const refundOrderEndpoint: Endpoint = {
  path: '/:id/refund',
  method: 'post',
  handler: async (req) => {
    if (!isAdminUser(getUser(req))) {
      return Response.json({ error: 'Only admins can refund orders.' }, { status: 403 })
    }
    const id = Number(req.routeParams?.id)
    const order = Number.isInteger(id)
      ? await req.payload.findByID({ collection: 'orders', id, depth: 0, disableErrors: true })
      : null
    if (!order) return Response.json({ error: 'Order not found.' }, { status: 404 })

    const { docs } = await req.payload.find({
      collection: 'payments',
      where: {
        and: [{ order: { equals: id } }, { status: { in: ['succeeded', 'partially_refunded'] } }],
      },
      sort: '-createdAt',
      limit: 1,
      depth: 0,
    })
    const payment = docs[0]
    if (!payment) {
      return Response.json({ error: 'This order has no paid payment.' }, { status: 409 })
    }
    try {
      const refund = await refundPayment(req.payload, {
        paymentId: payment.id,
        reason: 'requested_by_customer',
        description: `Refund for order ${order.orderNumber}`,
        // One refund per order payment: a double click returns the same refund.
        idempotencyKey: `order-${order.id}-payment-${payment.id}`,
      })
      const after = await req.payload.findByID({ collection: 'orders', id, depth: 0 })
      return Response.json({
        refund: { id: refund.id, status: refund.status, failureReason: refund.failureReason },
        order: { status: after.status, paymentStatus: after.paymentStatus },
      })
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Refund failed.' },
        { status: 400 },
      )
    }
  },
}

/** Orders get the refund endpoint and its button in the admin sidebar. */
const extendOrders: CollectionExtender = (collection) => ({
  ...inShopGroup(collection),
  endpoints: [...(collection.endpoints || []), refundOrderEndpoint],
  fields: [
    ...collection.fields,
    {
      name: 'refundOrder',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: { Field: '@/components/shop/RefundOrderButton#RefundOrderButton' },
      },
    },
  ],
})

/**
 * Applies a payment's status change to the shop order it pays for. Runs inside the request that
 * changed the payment (test provider callback, provider webhook, refund), like billing's
 * `syncPurchase` does for bookings.
 *
 * An order holds its stock from the moment it is placed. A payment that fails or is cancelled
 * therefore cancels the order, so the stock goes back on sale; the customer can put the same
 * items in their cart again from the order page.
 */
const syncOrder: CollectionAfterChangeHook<Payment> = async ({
  doc,
  previousDoc,
  operation,
  req,
  context,
}) => {
  if (context[SKIP_BILLING_SYNC]) return doc
  const before = operation === 'create' ? null : previousDoc?.status
  if (before === doc.status) return doc
  const orderId = relId(doc.order)
  if (!orderId) return doc

  const order = await req.payload.findByID({ collection: 'orders', id: orderId, depth: 0, req })
  let next: Partial<
    Pick<Order, 'status' | 'paymentStatus' | 'paymentMethod' | 'paymentId'>
  > | null = null
  if (doc.status === 'succeeded' && order.status === 'pending') {
    next = {
      status: 'processing',
      paymentStatus: 'paid',
      paymentMethod: doc.provider,
      paymentId: doc.providerId,
    }
  } else if ((doc.status === 'failed' || doc.status === 'canceled') && order.status === 'pending') {
    next = { status: 'cancelled', paymentStatus: 'failed' }
  } else if (doc.status === 'refunded' && order.paymentStatus === 'paid') {
    // A partial refund (e.g. a goodwill discount) leaves the order as it is.
    next = { status: 'refunded', paymentStatus: 'refunded' }
  }
  if (next) await req.payload.update({ collection: 'orders', id: orderId, data: next, req })
  return doc
}

/** Payments get the `order` they pay for, next to billing's `booking` and `membershipPlan`. */
const extendPayments = extendCollection('payments', (collection) => ({
  ...collection,
  fields: [
    ...collection.fields,
    {
      name: 'order',
      type: 'relationship',
      relationTo: 'orders',
      index: true,
      admin: { position: 'sidebar', description: 'The shop order this payment is for.' },
    },
  ],
  hooks: {
    ...collection.hooks,
    afterChange: [...(collection.hooks?.afterChange ?? []), syncOrder],
  },
}))

export const ecommerce: Plugin[] = [
  payloadEcommerce({
    userCollection: 'users',
    mediaCollection: 'media',
    isAdmin: ({ req }) => isAdminUser(getUser(req)),
    roundMoney: Math.round,
    collections: {
      products: extendProducts,
      categories: inShopGroup,
      orders: extendOrders,
      carts: inShopGroup,
      coupons: inShopGroup,
    },
  }),
  extendPayments,
]
