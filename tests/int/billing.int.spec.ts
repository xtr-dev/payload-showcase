import { refundPayment } from '@xtr-dev/payload-billing'
import { createLocalReq, type Endpoint, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { beginBookingCheckout, beginMembershipCheckout } from '@/lib/checkout'
import type { Booking, Payment, Session, User } from '@/payload-types'
import { seed, type SeedContext } from '@/seed'

import { getTestPayload, type TestPayload } from '../helpers/payload'

/**
 * Integration tests for the @xtr-dev/payload-billing integration: checkout, the test provider's
 * payment callback, refunds and access control. Payments are settled through the test
 * provider's own endpoint, the same one its checkout page calls.
 */

let t: TestPayload
let payload: Payload
let ctx: SeedContext
let mara: User
let jonas: User

const relId = (v: unknown) => (v && typeof v === 'object' ? (v as { id: number }).id : v)

const endpoint = (path: string, method: string): Endpoint => {
  const found = payload.config.endpoints.find((e) => e.path === path && e.method === method)
  if (!found) throw new Error(`No endpoint ${method} ${path}`)
  return found
}

const bookingEndpoint = (path: string): Endpoint => {
  const bookings = payload.config.collections.find((c) => c.slug === 'bookings')!
  const found = (bookings.endpoints || []).find((e) => e.path === path)
  if (!found) throw new Error(`No bookings endpoint ${path}`)
  return found
}

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

/** Pays (or declines) a test-provider payment the way its checkout page does. */
const settle = async (payment: Payment, scenarioId: string): Promise<Payment> => {
  const res = await endpoint('/payload-billing/test/process', 'post').handler(
    await request({ body: { paymentId: payment.providerId, scenarioId, method: 'ideal' } }),
  )
  expect(res.status).toBe(200)
  const initial = payment.status
  // The test provider applies the outcome after the scenario's delay (none for instant-success).
  for (let i = 0; i < 50; i++) {
    const current = await payload.findByID({ collection: 'payments', id: payment.id })
    if (current.status !== initial) return current
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Payment ${payment.id} was not settled`)
}

const seatsLeft = async (session: number | Session) =>
  (await payload.findByID({ collection: 'sessions', id: relId(session) as number })).seatsLeft ?? 0

/** A member books a session and starts checkout, as the booking page's server action does. */
const book = async (member: User, session: Session) => {
  const booking = await payload.create({
    collection: 'bookings',
    data: { session: session.id, status: 'pending' },
    user: member,
    overrideAccess: false,
  })
  const { redirectTo } = await beginBookingCheckout({ payload, booking, user: member })
  const latest = await payload.findByID({ collection: 'bookings', id: booking.id, depth: 0 })
  const payment = await payload.findByID({
    collection: 'payments',
    id: relId(latest.payment) as number,
  })
  return { booking: latest, payment, redirectTo }
}

const used = new Set<number>()
/** A session nobody has booked yet (neither the seed nor an earlier test). */
const nextSession = (): Session => {
  const booked = new Set(ctx.bookings.map((b) => relId(b.session)))
  const session = ctx.sessions.find((s) => !booked.has(s.id) && !used.has(s.id))
  if (!session) throw new Error('Out of free sessions')
  used.add(session.id)
  return session
}

const bookingStatus = async (booking: Booking) =>
  (await payload.findByID({ collection: 'bookings', id: booking.id, depth: 0 })).status

beforeAll(async () => {
  t = await getTestPayload()
  payload = t.payload
  ctx = await seed(payload)
  ;[mara, jonas] = ctx.members
})

afterAll(async () => {
  await t?.cleanup()
})

describe('Billing (payload-billing)', () => {
  it('is wired into the Payload config', () => {
    const slugs = payload.config.collections.map((c) => c.slug)
    expect(slugs).toEqual(expect.arrayContaining(['payments', 'invoices', 'refunds']))
    expect(payload.config.jobs.tasks?.map((task) => task.slug)).toEqual(
      expect.arrayContaining(['billingProcessRefund', 'billingRefundSweep']),
    )
  })

  describe('booking checkout', () => {
    it('takes a pending booking through payment to a confirmed seat', async () => {
      const session = nextSession()
      const before = await seatsLeft(session)
      const { booking, payment, redirectTo } = await book(jonas, session)

      // Checkout sends the member to the test provider's payment page on this site.
      expect(redirectTo).toBe(`/api/payload-billing/test/payment/${payment.providerId}`)
      expect(booking.status).toBe('pending')
      expect(await seatsLeft(session)).toBe(before - 1) // a pending booking holds its seat
      expect(payment).toMatchObject({
        provider: 'test',
        status: 'pending',
        amount: booking.amount,
        currency: 'EUR',
      })
      expect(relId(payment.member)).toBe(jonas.id)
      expect(relId(payment.booking)).toBe(booking.id)
      // The return URL carries the payment's return token, filled in by the plugin.
      expect(payment.returnToken).toMatch(/^[0-9a-f]{32}$/)
      expect(payment.redirectUrl).toBe(`/checkout/return?t=${payment.returnToken}`)

      const invoice = await payload.findByID({
        collection: 'invoices',
        id: relId(payment.invoice) as number,
      })
      expect(invoice).toMatchObject({ status: 'open', amount: booking.amount })
      expect(invoice.customerInfo).toMatchObject({ name: jonas.name, email: jonas.email })

      const paid = await settle(payment, 'instant-success')
      expect(paid.status).toBe('succeeded')
      expect(await bookingStatus(booking)).toBe('paid')
      expect(await seatsLeft(session)).toBe(before - 1)
      const paidInvoice = await payload.findByID({ collection: 'invoices', id: invoice.id })
      expect(paidInvoice.status).toBe('paid')
      expect(paidInvoice.paidAt).toBeTruthy()
    })

    it('keeps the booking pending when a payment is declined, and lets the member retry', async () => {
      const { booking, payment } = await book(mara, nextSession())
      const declined = await settle(payment, 'declined-payment')
      expect(declined.status).toBe('failed')
      expect(await bookingStatus(booking)).toBe('pending')

      // Retrying creates a new payment for the same open invoice.
      await beginBookingCheckout({ payload, booking, user: mara })
      const retried = await payload.findByID({ collection: 'bookings', id: booking.id, depth: 0 })
      const second = await payload.findByID({
        collection: 'payments',
        id: relId(retried.payment) as number,
      })
      expect(second.id).not.toBe(payment.id)
      expect(relId(second.invoice)).toBe(relId(payment.invoice))

      await settle(second, 'instant-success')
      expect(await bookingStatus(booking)).toBe('paid')
    })
  })

  describe('refunds', () => {
    it('lets an admin refund a booking, which frees the seat', async () => {
      const session = nextSession()
      const { booking, payment } = await book(jonas, session)
      await settle(payment, 'instant-success')
      const held = await seatsLeft(session)

      const refund = bookingEndpoint('/:id/refund').handler
      const denied = await refund(
        await request({ user: jonas, routeParams: { id: String(booking.id) } }),
      )
      expect(denied.status).toBe(403)

      const res = await refund(
        await request({ user: ctx.admin, routeParams: { id: String(booking.id) } }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.refund.status).toBe('succeeded')
      expect(body.booking.status).toBe('refunded')

      const after = await payload.findByID({ collection: 'payments', id: payment.id })
      expect(after.status).toBe('refunded')
      expect(after.refunds).toHaveLength(1)
      expect(await seatsLeft(session)).toBe(held + 1)

      // A second refund of the same booking is refused: nothing is left to refund.
      const again = await refund(
        await request({ user: ctx.admin, routeParams: { id: String(booking.id) } }),
      )
      expect(again.status).toBe(409)
    })

    it('keeps the seat on a partial refund', async () => {
      const session = nextSession()
      const { booking, payment } = await book(mara, session)
      await settle(payment, 'instant-success')
      await refundPayment(payload, { paymentId: payment.id, amount: 500, reason: 'other' })

      const after = await payload.findByID({ collection: 'payments', id: payment.id })
      expect(after.status).toBe('partially_refunded')
      expect(await bookingStatus(booking)).toBe('paid')
    })

    it('records a refund the provider rejects as failed and leaves the booking paid', async () => {
      const { booking, payment } = await book(jonas, nextSession())
      await settle(payment, 'instant-success')
      const refund = await refundPayment(payload, {
        paymentId: payment.id,
        metadata: { testScenario: 'refund-rejected' },
      })
      expect(refund.status).toBe('failed')
      expect(refund.failureReason).toBeTruthy()
      expect(await bookingStatus(booking)).toBe('paid')
    })

    it('sends refunds created in the admin through the billing job queue', async () => {
      const { booking, payment } = await book(mara, nextSession())
      await settle(payment, 'instant-success')
      // Creating a refund document only reserves it; the plugin queues a job that sends it.
      const reserved = await payload.create({
        collection: 'refunds',
        data: { payment: payment.id, amount: payment.amount, currency: 'EUR', status: 'pending' },
        user: ctx.admin,
        overrideAccess: false,
      })
      expect(reserved.status).toBe('pending')
      const { docs: jobs } = await payload.find({
        collection: 'payload-jobs',
        where: { taskSlug: { equals: 'billingProcessRefund' } },
        depth: 0,
      })
      expect(jobs.map((j) => [j.queue, (j.input as { refundId?: unknown })?.refundId])).toEqual([
        ['billing', reserved.id],
      ])

      await payload.jobs.run({ queue: 'billing' })

      const sent = await payload.findByID({ collection: 'refunds', id: reserved.id })
      expect(sent.status).toBe('succeeded')
      expect(sent.providerId).toMatch(/^test_re_/)
      expect(await bookingStatus(booking)).toBe('refunded')
    })

    it('does not queue a job for refunds the refund endpoint already sent', async () => {
      const count = async () =>
        (
          await payload.count({
            collection: 'payload-jobs',
            where: { taskSlug: { equals: 'billingProcessRefund' } },
          })
        ).totalDocs
      const before = await count()
      const { payment } = await book(mara, nextSession())
      await settle(payment, 'instant-success')
      await refundPayment(payload, { paymentId: payment.id, reason: 'other' })
      expect(await count()).toBe(before)
    })

    it('sends a pending refund whose job is gone from the refund sweep', async () => {
      const { booking, payment } = await book(mara, nextSession())
      await settle(payment, 'instant-success')
      const reserved = await payload.create({
        collection: 'refunds',
        data: { payment: payment.id, amount: payment.amount, currency: 'EUR', status: 'pending' },
        user: ctx.admin,
        overrideAccess: false,
      })
      await payload.delete({
        collection: 'payload-jobs',
        where: { taskSlug: { equals: 'billingProcessRefund' } },
      })

      await payload.jobs.queue({ task: 'billingRefundSweep', input: {}, queue: 'billing' })
      await payload.jobs.run({ queue: 'billing' })

      const sent = await payload.findByID({ collection: 'refunds', id: reserved.id })
      expect(sent.status).toBe('succeeded')
      expect(await bookingStatus(booking)).toBe('refunded')
    })
  })

  describe('membership checkout', () => {
    it('activates a membership once paid and cancels it on a full refund', async () => {
      const plan = ctx.plans[0]
      const { redirectTo } = await beginMembershipCheckout({ payload, plan, user: jonas })
      expect(redirectTo).toMatch(/^\/api\/payload-billing\/test\/payment\/test_pay_/)
      let member = await payload.findByID({ collection: 'users', id: jonas.id })
      expect(member.membershipStatus).toBe('pending')

      const { docs } = await payload.find({
        collection: 'payments',
        where: { member: { equals: jonas.id }, membershipPlan: { equals: plan.id } },
      })
      expect(docs).toHaveLength(1)
      await settle(docs[0], 'instant-success')
      member = await payload.findByID({ collection: 'users', id: jonas.id })
      expect(member.membershipStatus).toBe('active')
      expect(relId(member.membershipPlan)).toBe(plan.id)
      expect(new Date(member.membershipRenewsAt!).getTime()).toBeGreaterThan(Date.now())

      await refundPayment(payload, { paymentId: docs[0].id, reason: 'requested_by_customer' })
      member = await payload.findByID({ collection: 'users', id: jonas.id })
      expect(member.membershipStatus).toBe('cancelled')
    })
  })

  describe('access control', () => {
    it('shows members only their own payments, invoices and refunds', async () => {
      for (const member of [mara, jonas]) {
        const payments = await payload.find({
          collection: 'payments',
          user: member,
          overrideAccess: false,
          limit: 100,
        })
        expect(payments.totalDocs).toBeGreaterThan(0)
        expect(payments.docs.every((p) => relId(p.member) === member.id)).toBe(true)

        const invoices = await payload.find({
          collection: 'invoices',
          user: member,
          overrideAccess: false,
          limit: 100,
        })
        expect(invoices.totalDocs).toBeGreaterThan(0)
        expect(invoices.docs.every((i) => relId(i.customer) === member.id)).toBe(true)

        const refunds = await payload.find({
          collection: 'refunds',
          user: member,
          overrideAccess: false,
          depth: 0,
          limit: 100,
        })
        expect(refunds.totalDocs).toBeGreaterThan(0)
        const refunded = await payload.find({
          collection: 'payments',
          where: { id: { in: refunds.docs.map((r) => relId(r.payment)) } },
          limit: 100,
        })
        expect(refunded.docs.every((p) => relId(p.member) === member.id)).toBe(true)
      }

      const all = await payload.find({ collection: 'payments', user: ctx.admin, limit: 0 })
      const own = await payload.find({ collection: 'payments', user: mara, overrideAccess: false })
      expect(all.totalDocs).toBeGreaterThan(own.totalDocs)
    })

    it('does not let a member open another member’s invoice', async () => {
      const { docs } = await payload.find({
        collection: 'invoices',
        where: { customer: { equals: mara.id } },
        limit: 1,
      })
      await expect(
        payload.findByID({
          collection: 'invoices',
          id: docs[0].id,
          user: jonas,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })

    it('does not let members create, change or refund payments', async () => {
      const { docs } = await payload.find({
        collection: 'payments',
        where: { member: { equals: mara.id }, status: { equals: 'pending' } },
        limit: 1,
      })
      const pending = docs[0]
      expect(pending).toBeDefined()
      await expect(
        payload.update({
          collection: 'payments',
          id: pending.id,
          data: { status: 'succeeded' },
          user: mara,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      await expect(
        payload.create({
          collection: 'payments',
          data: {
            provider: 'test',
            status: 'pending',
            amount: 100,
            currency: 'EUR',
            member: mara.id,
          },
          user: mara,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      await expect(
        payload.create({
          collection: 'refunds',
          data: { payment: pending.id, amount: 100, currency: 'EUR', status: 'pending' },
          user: mara,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })

    it('hides billing from the public', async () => {
      for (const collection of ['payments', 'invoices', 'refunds'] as const) {
        await expect(payload.find({ collection, overrideAccess: false })).rejects.toThrow()
      }
    })
  })

  describe('seed', () => {
    it('gives the seeded members a payment and invoice history', async () => {
      const maraPayments = await payload.find({
        collection: 'payments',
        where: { member: { equals: mara.id } },
        sort: 'createdAt',
        limit: 100,
      })
      const seeded = maraPayments.docs.filter(
        (p) => new Date(p.createdAt) < new Date(Date.now() - 86_400_000),
      )
      // One paid booking and three months of membership, dated in the past.
      expect(seeded.map((p) => p.status)).toEqual([
        'succeeded',
        'partially_refunded',
        'succeeded',
        'succeeded',
      ])
      // Her pending booking can still be paid.
      const pendingBooking = ctx.bookings.find(
        (b) => relId(b.member) === mara.id && b.status === 'pending',
      )!
      const latest = await payload.findByID({
        collection: 'bookings',
        id: pendingBooking.id,
        depth: 1,
      })
      expect(typeof latest.payment === 'object' && latest.payment?.status).toBe('pending')

      const jonasPayments = await payload.find({
        collection: 'payments',
        where: { member: { equals: jonas.id }, createdAt: { less_than: ctx.admin.createdAt } },
        sort: 'createdAt',
      })
      expect(jonasPayments.docs.map((p) => p.status)).toEqual(['failed', 'succeeded'])
    })
  })
})
