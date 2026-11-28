import { refundPayment } from '@xtr-dev/payload-billing'
import { payloadEcommerce, type CollectionExtender } from '@xtr-dev/payload-ecommerce'
import type { CollectionAfterChangeHook, Endpoint, Payload, Plugin, TaskConfig } from 'payload'

import { getUser, isAdminUser } from '@/access'
import { TEMPLATES } from '@/lib/mailing'
import {
  cancelStaleOrders,
  notifyOrderShipped,
  sendOrderConfirmation,
  sendOrderShipped,
  STALE_ORDER_MINUTES,
} from '@/lib/shop'
import type { Order, Payment } from '@/payload-types'

import { SKIP_BILLING_SYNC } from './billing'
import { addFields, extendCollection } from './utils'

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
 * - Tie-ins with the other plugins hang off the order's own status: a paid order is confirmed by
 *   email (mailing), a shipped one is announced by email and in the member's inbox
 *   (notifications), and two
 *   automation workflows (src/seed/automation.ts) log paid orders with a low-stock warning and
 *   release orders that were never paid.
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

/** A paid order is confirmed once: a later status change never sends the email again. */
const hasConfirmation = async (payload: Payload, orderId: number): Promise<boolean> => {
  const { totalDocs } = await payload.count({
    collection: 'emails',
    where: { order: { equals: orderId }, templateSlug: { equals: TEMPLATES.orderConfirmation } },
  })
  return totalDocs > 0
}

/**
 * What customers hear about their order, sent from the order's own status changes so it does not
 * matter who made them (the payment sync, an admin, a workflow):
 *
 * - `paymentStatus` becomes `paid`: the confirmation email, to members and guests alike.
 * - `status` becomes `shipped`: the shipped email, to members and guests alike, and an inbox
 *   notification for the member (guests have no inbox, so the email is all they get).
 *
 * This is the site's own hook rather than the plugin's `afterCreateOrder`, which runs before
 * payment and fails the order when it throws. Problems here are logged and never block the order,
 * and each message is attempted on its own, so a mail failure does not cost the member their
 * notification.
 * Set `context: { skipMail: true }` or `{ skipNotifications: true }` on a write to stay quiet.
 */
const orderMessages: CollectionAfterChangeHook<Order> = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  const { payload, context } = req
  const was = operation === 'create' ? undefined : previousDoc
  const attempt = async (what: string, send: () => Promise<unknown>): Promise<void> => {
    try {
      await send()
    } catch (error) {
      payload.logger.error({ err: error, msg: `${what} for order ${doc.orderNumber} failed` })
    }
  }
  const paid = doc.paymentStatus === 'paid' && was?.paymentStatus !== 'paid'
  const shipped = doc.status === 'shipped' && was?.status !== 'shipped'
  if (!context.skipMail && paid && doc.customerEmail) {
    await attempt('Confirmation email', async () => {
      if (!(await hasConfirmation(payload, doc.id))) await sendOrderConfirmation(payload, doc)
    })
  }
  if (!context.skipMail && shipped && doc.customerEmail) {
    await attempt('Shipped email', () => sendOrderShipped(payload, doc))
  }
  if (!context.skipNotifications && shipped) {
    await attempt('Shipped notification', () => notifyOrderShipped(payload, doc, { req }))
  }
  return doc
}

/** Orders get the refund endpoint, its button in the admin sidebar and the customer messages. */
const extendOrders: CollectionExtender = (collection) => ({
  ...inShopGroup(collection),
  endpoints: [...(collection.endpoints || []), refundOrderEndpoint],
  hooks: {
    ...collection.hooks,
    afterChange: [...(collection.hooks?.afterChange ?? []), orderMessages],
  },
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
  const unpaid = doc.status === 'failed' || doc.status === 'canceled'
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
  } else if (unpaid && order.status === 'pending') {
    next = { status: 'cancelled', paymentStatus: 'failed' }
  } else if (doc.status === 'refunded' && order.paymentStatus === 'paid') {
    // A partial refund (e.g. a goodwill discount) leaves the order as it is.
    next = { status: 'refunded', paymentStatus: 'refunded' }
  }
  if (next) await req.payload.update({ collection: 'orders', id: orderId, data: next, req })

  // Nobody will pay this invoice any more: an order is not retried, a new cart makes a new order.
  const invoiceId = relId(doc.invoice)
  if (unpaid && invoiceId) {
    await req.payload.update({
      collection: 'invoices',
      where: { and: [{ id: { equals: invoiceId } }, { status: { equals: 'open' } }] },
      data: { status: 'void' },
      req,
    })
  }

  // Money arrived for an order that was cancelled in the meantime (it sat unpaid for too long
  // and its stock was released): the order cannot be honoured, so the payment is sent back.
  if (doc.status === 'succeeded' && order.status === 'cancelled') {
    req.payload.logger.warn(
      `Payment ${doc.id} arrived for cancelled order ${order.orderNumber}; refunding it`,
    )
    await refundPayment(req.payload, {
      paymentId: doc.id,
      reason: 'other',
      description: `Order ${order.orderNumber} was cancelled before its payment arrived`,
      idempotencyKey: `late-payment-${doc.id}`,
    }).catch((error) => {
      req.payload.logger.error({ err: error, msg: `Refund of late payment ${doc.id} failed` })
    })
  }
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

/**
 * Emails and notifications can point at the shop order they are about, so each is sent once per
 * order, and "Order shipped" joins the notification events.
 */
const linkMessagesToOrders: Plugin[] = [
  addFields('emails', [
    {
      name: 'order',
      type: 'relationship',
      relationTo: 'orders',
      index: true,
      admin: { position: 'sidebar', readOnly: true },
    },
  ]),
  extendCollection('notifications', (collection) => ({
    ...collection,
    fields: [
      ...collection.fields.map((field) =>
        'name' in field && field.name === 'event' && field.type === 'select'
          ? {
              ...field,
              options: [...field.options, { label: 'Order shipped', value: 'order-shipped' }],
            }
          : field,
      ),
      {
        name: 'order',
        type: 'relationship',
        relationTo: 'orders',
        index: true,
        admin: { position: 'sidebar', description: 'The shop order this notification is about.' },
      },
    ],
  })),
]

/**
 * A custom payload-automation step: cancels shop orders that have waited longer than
 * `olderThanMinutes` for their payment (see `cancelStaleOrders`). The "Release unpaid orders"
 * workflow in src/seed/automation.ts runs it on a schedule; src/plugins/automation.ts registers
 * it next to the plugin's built-in steps. A step is an ordinary Payload jobs task that returns
 * `output` and `state`.
 */
export const CANCEL_STALE_ORDERS_STEP = 'cancel-stale-orders' as const

export const CancelStaleOrdersStepTask: TaskConfig<'cancel-stale-orders'> = {
  slug: CANCEL_STALE_ORDERS_STEP,
  inputSchema: [
    {
      name: 'olderThanMinutes',
      type: 'number',
      min: 1,
      admin: { description: 'Cancel pending orders placed more than this many minutes ago.' },
    },
  ],
  outputSchema: [
    { name: 'cancelled', type: 'number' },
    { name: 'orderNumbers', type: 'json' },
  ],
  handler: async ({ input, req }) => {
    const minutes = Number(input?.olderThanMinutes)
    const orderNumbers = await cancelStaleOrders(req.payload, {
      olderThanMinutes: Number.isFinite(minutes) && minutes >= 1 ? minutes : STALE_ORDER_MINUTES,
    })
    return { output: { cancelled: orderNumbers.length, orderNumbers }, state: 'succeeded' }
  },
}

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
  ...linkMessagesToOrders,
]
