import { refundPayment } from '@xtr-dev/payload-billing'
import type { Payload } from 'payload'

import { beginBookingCheckout } from '@/lib/checkout'
import { SKIP_BILLING_SYNC } from '@/plugins/billing'
import type { Booking, Payment, User } from '@/payload-types'

import type { SeedContext } from './types'

/** Billing collections, in an order that is safe to delete. */
export const BILLING_COLLECTIONS = ['refunds', 'payments', 'invoices'] as const

const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString()

const relId = (value: unknown): number =>
  value && typeof value === 'object' ? (value as { id: number }).id : (value as number)

/**
 * Records a payment that already happened: an invoice and a test-provider payment with its
 * final status, dated in the past. The booking or membership it paid for was set up by the core
 * seed, so the billing sync hook is skipped.
 */
const recordPayment = async (
  payload: Payload,
  args: {
    member: User
    description: string
    amount: number
    status: Extract<Payment['status'], 'succeeded' | 'failed'>
    at: string
    booking?: Booking
    plan?: number
  },
): Promise<Payment> => {
  const context = { [SKIP_BILLING_SYNC]: true }
  const invoice = await payload.create({
    collection: 'invoices',
    data: {
      customer: args.member.id,
      currency: 'EUR',
      status: 'open',
      items: [{ description: args.description, quantity: 1, unitAmount: args.amount }],
      dueDate: args.at,
      notes: args.booking ? `Booking ${args.booking.reference}` : undefined,
      createdAt: args.at,
    },
    context,
  })
  const payment = await payload.create({
    collection: 'payments',
    data: {
      provider: 'test',
      status: args.status,
      amount: args.amount,
      currency: 'EUR',
      description: args.description,
      invoice: invoice.id,
      member: args.member.id,
      booking: args.booking?.id,
      membershipPlan: args.plan,
      redirectUrl: '/checkout/return?t={returnToken}',
      createdAt: args.at,
    },
    context,
  })
  // A succeeded payment marks its invoice paid (plugin hook); pin the dates to the past.
  await payload.update({
    collection: 'invoices',
    id: invoice.id,
    data: {
      payment: payment.id,
      ...(args.status === 'succeeded' ? { status: 'paid', paidAt: args.at } : {}),
    },
    context,
  })
  if (args.booking && args.status === 'succeeded') {
    await payload.update({
      collection: 'bookings',
      id: args.booking.id,
      data: { payment: payment.id },
    })
  }
  return payment
}

/**
 * Seed data for the Billing integration: a realistic payment history for the seeded members.
 *
 * - Every paid booking gets its invoice and succeeded payment. Jonas's card was declined once
 *   before his payment went through.
 * - Mara's pending booking gets an open invoice and a pending payment she can still pay from
 *   her account (through the test provider).
 * - Mara's membership has three months of paid invoices, one with a partial refund (the studio
 *   was closed for a week while the kiln was repaired).
 */
export const seedBilling = async (
  payload: Payload,
  ctx: SeedContext,
  { reset }: { reset: boolean },
): Promise<void> => {
  if (reset) {
    for (const collection of BILLING_COLLECTIONS) {
      await payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true })
    }
  }

  const members = new Map(ctx.members.map((m) => [m.id, m]))

  for (const [i, booking] of ctx.bookings.entries()) {
    const member = members.get(relId(booking.member))
    if (!member) continue
    const session = ctx.sessions.find((s) => s.id === relId(booking.session))
    const workshop = ctx.workshops.find((w) => w.id === relId(booking.workshop))
    if (!session || !workshop) continue

    if (booking.status === 'pending') {
      await beginBookingCheckout({ payload, booking, user: member })
      continue
    }
    if (booking.status !== 'paid') continue

    const when = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Amsterdam',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(session.startsAt))
    const description = `${workshop.title}, ${when} (${booking.reference})`
    const paidDaysAgo = 6 + i * 3
    if (member.email.startsWith('jonas')) {
      await recordPayment(payload, {
        member,
        description,
        amount: booking.amount ?? workshop.price,
        status: 'failed',
        at: daysAgo(paidDaysAgo + 1),
        booking,
      })
    }
    await recordPayment(payload, {
      member,
      description,
      amount: booking.amount ?? workshop.price,
      status: 'succeeded',
      at: daysAgo(paidDaysAgo),
      booking,
    })
  }

  for (const member of ctx.members) {
    const planId = member.membershipPlan ? relId(member.membershipPlan) : undefined
    const plan = ctx.plans.find((p) => p.id === planId)
    if (!plan || member.membershipStatus !== 'active') continue
    for (const monthsAgo of [3, 2, 1]) {
      const at = new Date()
      at.setUTCMonth(at.getUTCMonth() - monthsAgo)
      const month = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(at)
      const payment = await recordPayment(payload, {
        member,
        description: `${plan.name} membership, ${month}`,
        amount: plan.price,
        status: 'succeeded',
        at: at.toISOString(),
        plan: plan.id,
      })
      if (monthsAgo === 2) {
        // A real refund through the test provider: a quarter of the month back.
        await refundPayment(payload, {
          paymentId: payment.id,
          amount: Math.round(plan.price / 4),
          reason: 'other',
          description: 'Studio closed for a week while the kiln was repaired',
          idempotencyKey: `seed-kiln-repair-${member.id}`,
        })
      }
    }
  }
}
