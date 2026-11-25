import type { Payload } from 'payload'

import { checkoutProvider } from '@/plugins/billing'
import type { Booking, Invoice, MembershipPlan, Payment, User } from '@/payload-types'

import { formatDate } from './format'

/**
 * Checkout entry points used by the booking and membership pages, built on
 * @xtr-dev/payload-billing.
 *
 * Each checkout creates an open invoice for the member and a payment linked to it and to what it
 * pays for (a booking or a membership plan). Creating the payment makes the plugin call the
 * provider, which returns a checkout URL; the visitor is sent there. After paying, the provider
 * sends them to `/checkout/return?t={returnToken}`, and the payment's status change (reported by
 * the test provider or a webhook) confirms the booking or activates the membership; see
 * `syncPurchase` in src/plugins/billing.ts.
 */

export interface CheckoutResult {
  /** Where to send the visitor next: a payment page, or a confirmation page. */
  redirectTo: string
}

const relId = (value: unknown): number | undefined => {
  if (value && typeof value === 'object' && 'id' in value) return (value as { id: number }).id
  return typeof value === 'number' ? value : undefined
}

/** Absolute site origin for providers that redirect from their own domain (Mollie). */
const siteOrigin = (): string =>
  (process.env.PAYLOAD_SERVER_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000')
    .trim()
    .replace(/\/$/, '')

/**
 * The return page URL. `{returnToken}` is filled in by the plugin. The test provider redirects
 * from a page on this site, so a relative URL works on any host and port; Mollie needs an
 * absolute one.
 */
const returnUrl = (provider: Payment['provider']): string => {
  const path = '/checkout/return?t={returnToken}'
  return provider === 'test' ? path : `${siteOrigin()}${path}`
}

/**
 * Where to send the visitor to pay. The test provider's checkout page is served by this site
 * (`/api/payload-billing/test/payment/:id`), so its absolute URL, built from the configured
 * server URL, is reduced to a path that works on whatever host served the request.
 */
export const paymentLink = (
  payment: Pick<Payment, 'provider' | 'checkoutUrl' | 'returnToken'>,
): string => {
  if (payment.checkoutUrl) {
    if (payment.provider !== 'test') return payment.checkoutUrl
    const url = new URL(payment.checkoutUrl, 'http://localhost')
    return `${url.pathname}${url.search}`
  }
  return `/checkout/return?t=${encodeURIComponent(payment.returnToken ?? '')}`
}

/** Creates the payment for an invoice; the plugin asks the provider for a checkout on create. */
const createPayment = async (
  payload: Payload,
  data: {
    invoice: Invoice
    description: string
    member: User
    booking?: number
    membershipPlan?: number
  },
): Promise<Payment> => {
  const provider = checkoutProvider()
  const payment = await payload.create({
    collection: 'payments',
    data: {
      provider,
      status: 'pending',
      amount: data.invoice.amount ?? 0,
      currency: data.invoice.currency,
      description: data.description,
      invoice: data.invoice.id,
      member: data.member.id,
      booking: data.booking,
      membershipPlan: data.membershipPlan,
      redirectUrl: returnUrl(provider),
      metadata: { invoice: data.invoice.number },
    },
    overrideAccess: true,
  })
  await payload.update({
    collection: 'invoices',
    id: data.invoice.id,
    data: { payment: payment.id },
    overrideAccess: true,
  })
  return payment
}

/** Reuses the booking's open invoice (when retrying a failed payment) or creates one. */
const invoiceForBooking = async (
  payload: Payload,
  booking: Booking,
  user: User,
  description: string,
): Promise<Invoice> => {
  const previous = relId(booking.payment)
  if (previous) {
    const payment = await payload
      .findByID({ collection: 'payments', id: previous, depth: 1, overrideAccess: true })
      .catch(() => null)
    const invoice = payment && typeof payment.invoice === 'object' ? payment.invoice : null
    if (invoice && invoice.status === 'open') return invoice
  }
  return payload.create({
    collection: 'invoices',
    data: {
      customer: user.id,
      currency: booking.currency ?? 'EUR',
      status: 'open',
      items: [{ description, quantity: 1, unitAmount: booking.amount ?? 0 }],
      notes: `Booking ${booking.reference}`,
      metadata: { booking: booking.reference },
    },
    overrideAccess: true,
  })
}

/**
 * Called right after a pending booking is created for the signed-in member, and again when the
 * member retries a failed payment for it.
 */
export const beginBookingCheckout = async ({
  payload,
  booking,
  user,
}: {
  payload: Payload
  booking: Booking
  user: User
}): Promise<CheckoutResult> => {
  const session =
    typeof booking.session === 'object'
      ? booking.session
      : await payload.findByID({ collection: 'sessions', id: booking.session, depth: 0 })
  const workshop =
    typeof booking.workshop === 'object' && booking.workshop
      ? booking.workshop
      : await payload.findByID({
          collection: 'workshops',
          id: relId(session.workshop)!,
          depth: 0,
          draft: true,
        })
  const description = `${workshop.title}, ${formatDate(session.startsAt)} (${booking.reference})`

  // A free seat needs no payment (payments must be at least one cent).
  if (!booking.amount) {
    await payload.update({ collection: 'bookings', id: booking.id, data: { status: 'paid' } })
    return { redirectTo: `/account?booked=${encodeURIComponent(booking.reference ?? '')}` }
  }

  const invoice = await invoiceForBooking(payload, booking, user, description)
  const payment = await createPayment(payload, {
    invoice,
    description,
    member: user,
    booking: booking.id,
  })
  await payload.update({
    collection: 'bookings',
    id: booking.id,
    data: { payment: payment.id },
    overrideAccess: true,
  })
  return { redirectTo: paymentLink(payment) }
}

/** Called when a signed-in member chooses a membership plan. */
export const beginMembershipCheckout = async ({
  payload,
  plan,
  user,
}: {
  payload: Payload
  plan: MembershipPlan
  user: User
}): Promise<CheckoutResult> => {
  // An active member switching plans keeps their current plan until the new one is paid.
  if (user.membershipStatus !== 'active') {
    await payload.update({
      collection: 'users',
      id: user.id,
      data: { membershipPlan: plan.id, membershipStatus: 'pending' },
      overrideAccess: true,
    })
  }
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    new Date(),
  )
  const description = `${plan.name} membership, ${month}`
  const invoice = await payload.create({
    collection: 'invoices',
    data: {
      customer: user.id,
      currency: 'EUR',
      status: 'open',
      items: [{ description, quantity: 1, unitAmount: plan.price }],
      metadata: { plan: plan.slug },
    },
    overrideAccess: true,
  })
  const payment = await createPayment(payload, {
    invoice,
    description,
    member: user,
    membershipPlan: plan.id,
  })
  return { redirectTo: paymentLink(payment) }
}
