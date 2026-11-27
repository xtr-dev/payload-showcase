import {
  billingPlugin,
  refundPayment,
  testProvider,
  type PaymentProvider,
} from '@xtr-dev/payload-billing'
import { mollieProvider } from '@xtr-dev/payload-billing/mollie'
import { stripeProvider } from '@xtr-dev/payload-billing/stripe'
import type {
  Access,
  CollectionAfterChangeHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  Endpoint,
  JobsConfig,
  Plugin,
} from 'payload'

import { getUser, isAdmin, isAdminField, isAdminUser } from '@/access'
import type { Booking, Invoice, Payment } from '@/payload-types'

import { addFields, extendCollection } from './utils'

/**
 * @xtr-dev/payload-billing
 *
 * Checkout for workshop bookings and memberships, with payments, invoices and refunds.
 *
 * - Providers: the plugin's local test provider is always on (it needs no keys, so the demo,
 *   the tests and CI work out of the box). Mollie and Stripe are added when their keys are set.
 *   Checkout uses Mollie when `MOLLIE_API_KEY` is set and the test provider otherwise; see
 *   `checkoutProvider` below for why Stripe is registered but not used for checkout.
 * - Customers sign up in the same `users` collection as staff, so the plugin's default access
 *   ("anyone in the admin user collection") would let every member read every payment. Access is
 *   therefore set explicitly: members read only their own payments, invoices and refunds, and
 *   only admins write.
 * - Payments get `member`, `booking` and `membershipPlan` relationships. A payment's status
 *   changes drive the booking (`pending → paid → refunded`, which also frees the seat through
 *   the Bookings hooks) and the member's membership (`pending → active → cancelled`).
 */

const env = {
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  mollieApiKey: process.env.MOLLIE_API_KEY,
}

/**
 * The provider every new checkout payment uses. Mollie when configured: it is a redirect flow,
 * which is what the booking pages do. Stripe's provider in this plugin creates a PaymentIntent
 * that needs a Stripe.js payment form on the site, which the showcase does not ship, so Stripe
 * only records payments that reach its webhook.
 */
export const checkoutProvider = (): 'mollie' | 'test' => (env.mollieApiKey ? 'mollie' : 'test')

/** Every provider that is configured, in the order the admin shows them. */
const providers: Array<PaymentProvider | undefined> = [
  testProvider({
    enabled: true,
    // Payment URLs are built from PAYLOAD_SERVER_URL / NEXT_PUBLIC_SERVER_URL; checkout turns
    // them into site-relative links, so the test checkout also works on other ports (e2e).
    testModeIndicators: { showWarningBanners: true, showTestBadges: true, consoleWarnings: false },
  }),
  env.mollieApiKey ? mollieProvider({ apiKey: env.mollieApiKey }) : undefined,
  env.stripeSecretKey
    ? stripeProvider({ secretKey: env.stripeSecretKey, webhookSecret: env.stripeWebhookSecret })
    : undefined,
]

const relId = (value: unknown): number | undefined => {
  if (value && typeof value === 'object' && 'id' in value) return (value as { id: number }).id
  return typeof value === 'number' ? value : undefined
}

/** Admins read everything; members only documents whose `field` points at themselves. */
const ownOrAdmin =
  (field: string): Access =>
  ({ req }) => {
    const user = getUser(req)
    if (!user) return false
    if (isAdminUser(user)) return true
    return { [field]: { equals: user.id } }
  }

const writeAccess = { create: isAdmin, update: isAdmin, delete: isAdmin }

/** Set `context.skipBillingSync` on a payment write to leave bookings and memberships alone. */
export const SKIP_BILLING_SYNC = 'skipBillingSync'

const addMonths = (date: Date, months: number): Date => {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

/**
 * Applies a payment's status change to what it paid for. Runs inside the request that changed
 * the payment (test provider callback, provider webhook, refund), so the booking update and the
 * seat release share its transaction.
 */
const syncPurchase: CollectionAfterChangeHook<Payment> = async ({
  doc,
  previousDoc,
  operation,
  req,
  context,
}) => {
  if (context[SKIP_BILLING_SYNC]) return doc
  const before = operation === 'create' ? null : previousDoc?.status
  if (before === doc.status) return doc

  const bookingId = relId(doc.booking)
  if (bookingId) {
    const booking = await req.payload.findByID({
      collection: 'bookings',
      id: bookingId,
      depth: 0,
      req,
    })
    let next: Booking['status'] | undefined
    if (doc.status === 'succeeded' && booking.status === 'pending') next = 'paid'
    // A partial refund (e.g. a goodwill discount) keeps the seat; a full refund gives it back.
    if (doc.status === 'refunded' && booking.status === 'paid') next = 'refunded'
    if (next) {
      await req.payload.update({
        collection: 'bookings',
        id: bookingId,
        data: { status: next, payment: doc.id },
        req,
      })
    }
  }

  const planId = relId(doc.membershipPlan)
  const memberId = relId(doc.member)
  if (planId && memberId) {
    if (doc.status === 'succeeded') {
      await req.payload.update({
        collection: 'users',
        id: memberId,
        data: {
          membershipPlan: planId,
          membershipStatus: 'active',
          membershipRenewsAt: addMonths(new Date(), 1).toISOString(),
        },
        req,
      })
    } else if (doc.status === 'refunded') {
      const member = await req.payload.findByID({
        collection: 'users',
        id: memberId,
        depth: 0,
        req,
      })
      if (relId(member.membershipPlan) === planId && member.membershipStatus === 'active') {
        await req.payload.update({
          collection: 'users',
          id: memberId,
          data: { membershipStatus: 'cancelled', membershipRenewsAt: null },
          req,
        })
      }
    }
  }
  return doc
}

const extendPayments = (collection: CollectionConfig): CollectionConfig => ({
  ...collection,
  admin: {
    ...collection.admin,
    defaultColumns: ['description', 'member', 'provider', 'status', 'amount', 'createdAt'],
    useAsTitle: 'description',
  },
  fields: [
    ...collection.fields,
    {
      name: 'member',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      admin: { position: 'sidebar', description: 'The member who pays.' },
    },
    {
      name: 'booking',
      type: 'relationship',
      relationTo: 'bookings',
      index: true,
      admin: { position: 'sidebar', description: 'The workshop booking this payment is for.' },
    },
    {
      name: 'membershipPlan',
      type: 'relationship',
      relationTo: 'membership-plans',
      admin: { position: 'sidebar', description: 'The membership this payment is for.' },
    },
  ],
  hooks: {
    ...collection.hooks,
    afterChange: [...(collection.hooks?.afterChange ?? []), syncPurchase],
  },
})

/**
 * Copies the member's name and email into the invoice's customer block when the invoice is
 * created or handed to another member, so invoices stay correct as a record even if the member
 * later changes their name or email.
 *
 * The plugin's own `customerInfoExtractor` does the same, but it also makes `customer` mandatory,
 * and the shop invoices guests, who have no user. Without the extractor the plugin accepts an
 * invoice that has either a customer or a name and email; this hook runs before that check.
 */
const snapshotCustomer: CollectionBeforeValidateHook<Invoice> = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  const customerId = relId(data?.customer)
  if (!data || !customerId) return data
  if (operation === 'create' || relId(originalDoc?.customer) !== customerId) {
    const customer = await req.payload.findByID({
      collection: 'users',
      id: customerId,
      depth: 0,
      req,
    })
    data.customerInfo = { ...data.customerInfo, name: customer.name, email: customer.email }
  }
  return data
}

const extendInvoices = (collection: CollectionConfig): CollectionConfig => ({
  ...collection,
  hooks: {
    ...collection.hooks,
    beforeValidate: [snapshotCustomer, ...(collection.hooks?.beforeValidate ?? [])],
  },
})

/**
 * `POST /api/bookings/:id/refund` (admins only): refunds the booking's payment in full through
 * its provider. The payment then becomes `refunded`, which marks the booking refunded and gives
 * its seat back. Used by the "Refund booking" button in the booking's admin sidebar.
 */
const refundBookingEndpoint: Endpoint = {
  path: '/:id/refund',
  method: 'post',
  handler: async (req) => {
    if (!isAdminUser(getUser(req))) {
      return Response.json({ error: 'Only admins can refund bookings.' }, { status: 403 })
    }
    const id = Number(req.routeParams?.id)
    const booking = await req.payload
      .findByID({ collection: 'bookings', id, depth: 0 })
      .catch(() => null)
    if (!booking) return Response.json({ error: 'Booking not found.' }, { status: 404 })

    const { docs } = await req.payload.find({
      collection: 'payments',
      where: {
        and: [{ booking: { equals: id } }, { status: { in: ['succeeded', 'partially_refunded'] } }],
      },
      sort: '-createdAt',
      limit: 1,
      depth: 0,
    })
    const payment = docs[0]
    if (!payment) {
      return Response.json({ error: 'This booking has no paid payment.' }, { status: 409 })
    }
    try {
      const refund = await refundPayment(req.payload, {
        paymentId: payment.id,
        reason: 'requested_by_customer',
        description: `Refund for booking ${booking.reference}`,
        // One refund per booking payment: a double click returns the same refund.
        idempotencyKey: `booking-${booking.id}-payment-${payment.id}`,
      })
      const after = await req.payload.findByID({ collection: 'bookings', id, depth: 0 })
      return Response.json({
        refund: { id: refund.id, status: refund.status, failureReason: refund.failureReason },
        booking: { status: after.status },
      })
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Refund failed.' },
        { status: 400 },
      )
    }
  },
}

/** Jobs queue of the plugin's refund tasks (see `refundJobs` below). */
const BILLING_QUEUE = 'billing'

/**
 * Runs the billing queue every minute, without dropping other plugins' crons. The plugin's
 * `refundJobs` registers the tasks (sending one admin-created refund, and the refund sweep on its
 * own schedule); the host has to run their queue.
 */
const billingJobs: Plugin = (config) => {
  const jobs: JobsConfig = config.jobs ?? {}
  const autoRun = jobs.autoRun
  const ours = [{ cron: '* * * * *', queue: BILLING_QUEUE }]
  const otherShouldAutoRun = jobs.shouldAutoRun
  return {
    ...config,
    jobs: {
      ...jobs,
      autoRun:
        typeof autoRun === 'function'
          ? async (payload) => [...(await autoRun(payload)), ...ours]
          : [...(autoRun ?? []), ...ours],
      // Tests set DISABLE_JOBS_AUTORUN so no cron fires while they run.
      shouldAutoRun: async (payload) =>
        process.env.DISABLE_JOBS_AUTORUN !== 'true' &&
        (otherShouldAutoRun ? await otherShouldAutoRun(payload) : true),
    },
  }
}

export const billing: Plugin[] = [
  billingPlugin({
    providers,
    customerRelationSlug: 'users',
    // Refunds created by hand (Billing → Refunds → Create) are only reservations; with this the
    // plugin queues a job that sends each one to the provider, plus a sweep every five minutes for
    // refunds left pending or still processing at the provider.
    refundJobs: { queue: BILLING_QUEUE },
    collections: {
      payments: { access: { read: ownOrAdmin('member'), ...writeAccess }, extend: extendPayments },
      invoices: {
        access: { read: ownOrAdmin('customer'), ...writeAccess },
        extend: extendInvoices,
      },
      refunds: { access: { read: ownOrAdmin('payment.member'), ...writeAccess } },
    },
    hooks: {
      onRefundFailed: ({ refund, payload }) => {
        payload.logger.warn(`Refund ${refund.id} failed: ${refund.failureReason ?? 'unknown'}`)
      },
    },
  }),
  addFields('bookings', [
    {
      name: 'payment',
      type: 'relationship',
      relationTo: 'payments',
      access: { create: isAdminField, update: isAdminField },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'The latest payment for this booking (set by checkout).',
      },
    },
    {
      name: 'refundBooking',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: { Field: '@/components/billing/RefundBookingButton#RefundBookingButton' },
      },
    },
  ]),
  extendCollection('bookings', (collection) => ({
    ...collection,
    endpoints: [...(collection.endpoints || []), refundBookingEndpoint],
  })),
  billingJobs,
]
