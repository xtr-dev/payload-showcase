import { syncPaymentFromProvider } from '@xtr-dev/payload-billing'
import type { Metadata } from 'next'
import Link from 'next/link'

import { retryBookingPayment } from '@/components/billing/actions'
import { ReturnPoller } from '@/components/billing/ReturnPoller'
import { Alert, Badge, Button, ButtonLink, Card, Container } from '@/components/ui'
import { getCurrentUser } from '@/lib/auth'
import { formatDate, formatPrice, formatTime } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import type { Payment } from '@/payload-types'

export const metadata: Metadata = { title: 'Payment', robots: { index: false } }

const relId = (value: unknown): number | undefined =>
  value && typeof value === 'object' ? (value as { id: number }).id : (value as number | undefined)

const OPEN: ReadonlyArray<Payment['status']> = ['pending', 'processing']

/**
 * Where the payment provider sends the visitor back to: `/checkout/return?t={returnToken}`.
 *
 * The token stands in for the payment (the provider gets the URL before the payment has an id),
 * so it is treated as a bearer secret for that one payment: the page shows only its status and
 * what it paid for. While the provider has not reported back yet, the page polls. Mollie
 * payments whose webhook cannot reach this server (e.g. on localhost) are pulled from Mollie
 * with `syncPaymentFromProvider`.
 */
export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { t } = await searchParams
  const token = typeof t === 'string' && /^[0-9a-f]{32}$/.test(t) ? t : null
  const payload = await getPayloadClient()
  const user = await getCurrentUser()

  const find = async () =>
    token
      ? (
          await payload.find({
            collection: 'payments',
            where: { returnToken: { equals: token } },
            depth: 2,
            limit: 1,
            overrideAccess: true,
          })
        ).docs[0]
      : undefined

  let payment = await find()
  if (payment && payment.provider === 'mollie' && OPEN.includes(payment.status)) {
    await syncPaymentFromProvider(payload, payment.id).catch(() => null)
    payment = await find()
  }

  if (!payment) {
    return (
      <Container narrow className="py-14 lg:py-20">
        <h1 className="text-4xl text-ink sm:text-5xl">We couldn’t find that payment</h1>
        <p className="mt-4 text-lg text-ink-soft">
          The link may be incomplete. Your bookings and payments are always listed in your account.
        </p>
        <ButtonLink href="/account" className="mt-8">
          Go to My studio
        </ButtonLink>
      </Container>
    )
  }

  const booking = typeof payment.booking === 'object' ? payment.booking : null
  const session = booking && typeof booking.session === 'object' ? booking.session : null
  const plan = typeof payment.membershipPlan === 'object' ? payment.membershipPlan : null
  const invoiceId = relId(payment.invoice)
  const isOwner = !!user && relId(payment.member) === user.id
  const open = OPEN.includes(payment.status)
  const paid = ['succeeded', 'partially_refunded', 'refunded'].includes(payment.status)
  const canRetry = !open && !paid && isOwner && booking?.status === 'pending'

  const heading = open
    ? 'Confirming your payment…'
    : paid
      ? booking
        ? 'You’re booked in!'
        : 'Welcome to the studio!'
      : 'Your payment didn’t go through'

  return (
    <Container narrow className="py-14 lg:py-20">
      {open && <ReturnPoller />}
      <p className="text-sm font-semibold tracking-[0.14em] text-clay uppercase">Checkout</p>
      <h1 className="mt-2 text-4xl text-ink sm:text-5xl" data-testid="checkout-heading">
        {heading}
      </h1>

      <Card className="mt-8 p-6 sm:p-8" data-testid="checkout-result">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-ink">{payment.description}</p>
            {session && (
              <p className="text-sm text-ink-soft">
                {formatDate(session.startsAt)}, {formatTime(session.startsAt)}
              </p>
            )}
          </div>
          <Badge tone={paid ? 'success' : open ? 'warning' : 'danger'}>
            {paid
              ? 'Paid'
              : open
                ? 'Processing'
                : payment.status === 'failed'
                  ? 'Declined'
                  : 'Cancelled'}
          </Badge>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm">
          <div>
            <dt className="text-ink-soft">Amount</dt>
            <dd className="font-display text-2xl font-semibold text-clay">
              {formatPrice(payment.amount, payment.currency)}
            </dd>
          </div>
          {booking?.reference && (
            <div>
              <dt className="text-ink-soft">Booking</dt>
              <dd className="font-mono font-semibold">{booking.reference}</dd>
            </div>
          )}
          {plan && (
            <div>
              <dt className="text-ink-soft">Plan</dt>
              <dd className="font-semibold">{plan.name}</dd>
            </div>
          )}
        </dl>

        {open && (
          <p className="mt-6 text-sm text-ink-soft" role="status">
            Waiting for the payment provider to confirm. This page updates by itself.
          </p>
        )}
        {paid && (
          <Alert tone="success" className="mt-6">
            {booking
              ? 'Your seat is confirmed. We’ll see you at the studio. Aprons are on us.'
              : 'Your membership is active. Open-studio hours start whenever you’re ready.'}
          </Alert>
        )}
        {!open && !paid && (
          <Alert tone="warning" className="mt-6">
            Nothing was charged.{' '}
            {booking?.status === 'pending'
              ? 'Your seat stays reserved while you try again.'
              : plan
                ? 'You can choose your plan again whenever you like.'
                : ''}
          </Alert>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          {canRetry && booking && (
            <form action={retryBookingPayment}>
              <input type="hidden" name="bookingId" value={booking.id} />
              <Button type="submit">Try again</Button>
            </form>
          )}
          {!open && !paid && plan && (
            <ButtonLink href={`/membership/join/${plan.slug}`}>Try again</ButtonLink>
          )}
          <ButtonLink href="/account" variant={canRetry || plan ? 'outline' : 'primary'}>
            Go to My studio
          </ButtonLink>
          {isOwner && invoiceId && paid && (
            <ButtonLink href={`/account/invoices/${invoiceId}`} variant="ghost">
              View invoice
            </ButtonLink>
          )}
        </div>
      </Card>

      <p className="mt-6 text-sm text-ink-soft">
        Payments on this demo run through the{' '}
        <Link href="/showcase#billing" className="font-medium text-clay hover:underline">
          payload-billing
        </Link>{' '}
        {payment.provider === 'test'
          ? 'test provider: no real money moves.'
          : `${payment.provider} provider.`}
      </p>
    </Container>
  )
}
