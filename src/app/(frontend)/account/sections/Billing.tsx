import Link from 'next/link'

import { retryBookingPayment } from '@/components/billing/actions'
import { Badge, Button, ButtonLink, Card, type BadgeTone } from '@/components/ui'
import { paymentLink } from '@/lib/checkout'
import { formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import type { Invoice, Payment, User } from '@/payload-types'

const PAYMENT_STATUS: Record<Payment['status'], { label: string; tone: BadgeTone }> = {
  pending: { label: 'Awaiting payment', tone: 'warning' },
  processing: { label: 'Processing', tone: 'warning' },
  succeeded: { label: 'Paid', tone: 'success' },
  failed: { label: 'Declined', tone: 'danger' },
  canceled: { label: 'Cancelled', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  partially_refunded: { label: 'Partly refunded', tone: 'glaze' },
}

const INVOICE_STATUS: Record<Invoice['status'], { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  open: { label: 'Open', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  void: { label: 'Void', tone: 'neutral' },
  uncollectible: { label: 'Uncollectible', tone: 'danger' },
}

const relId = (value: unknown): number | undefined =>
  value && typeof value === 'object' ? (value as { id: number }).id : (value as number | undefined)

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  )

/**
 * The member's payments and invoices (from @xtr-dev/payload-billing). Everything is read with the
 * member's own access, so the billing collections' access rules decide what shows up here.
 */
export const BillingSection = async ({ user }: { user: User }) => {
  const payload = await getPayloadClient()
  const asMember = { user, overrideAccess: false } as const
  const [{ docs: payments }, { docs: invoices }, { docs: refunds }] = await Promise.all([
    payload.find({ collection: 'payments', sort: '-createdAt', depth: 1, limit: 50, ...asMember }),
    payload.find({ collection: 'invoices', sort: '-createdAt', depth: 0, limit: 50, ...asMember }),
    payload.find({
      collection: 'refunds',
      where: { status: { equals: 'succeeded' } },
      depth: 0,
      limit: 100,
      ...asMember,
    }),
  ])

  const refunded = new Map<number, number>()
  for (const r of refunds) {
    const id = relId(r.payment)
    if (id) refunded.set(id, (refunded.get(id) ?? 0) + r.amount)
  }
  // Only the newest payment of a booking can still be paid or retried.
  const latestForBooking = new Map<number, number>()
  for (const p of payments) {
    const booking = relId(p.booking)
    if (booking && !latestForBooking.has(booking)) latestForBooking.set(booking, p.id)
  }

  return (
    <Card as="section" className="p-6" aria-labelledby="billing-heading" data-testid="billing">
      <h2 id="billing-heading" className="text-2xl text-ink">
        Payments &amp; invoices
      </h2>

      {payments.length === 0 ? (
        <p className="mt-4 text-ink-soft">No payments yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line" data-testid="payments">
          {payments.map((p) => {
            const booking = typeof p.booking === 'object' ? p.booking : null
            const latest = booking ? latestForBooking.get(booking.id) === p.id : true
            const payable = latest && p.status === 'pending' && booking?.status !== 'cancelled'
            const retry =
              latest && booking?.status === 'pending' && ['failed', 'canceled'].includes(p.status)
            const back = refunded.get(p.id)
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{p.description}</p>
                  <p className="text-sm text-ink-soft">
                    {shortDate(p.createdAt)} · {formatPrice(p.amount, p.currency)}
                    {back ? ` · ${formatPrice(back, p.currency)} refunded` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={PAYMENT_STATUS[p.status].tone}>
                    {PAYMENT_STATUS[p.status].label}
                  </Badge>
                  {payable && (
                    <ButtonLink href={paymentLink(p)} size="sm">
                      Pay now
                    </ButtonLink>
                  )}
                  {retry && booking && (
                    <form action={retryBookingPayment}>
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <Button type="submit" size="sm">
                        Try again
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <h3 className="mt-8 font-display text-xl text-ink">Invoices</h3>
      {invoices.length === 0 ? (
        <p className="mt-2 text-ink-soft">No invoices yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line" data-testid="invoices">
          {invoices.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <Link
                  href={`/account/invoices/${inv.id}`}
                  className="font-mono font-semibold text-clay hover:underline"
                >
                  {inv.number}
                </Link>
                <p className="text-sm text-ink-soft">
                  {shortDate(inv.createdAt)} · {inv.items[0]?.description}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">{formatPrice(inv.amount, inv.currency)}</span>
                <Badge tone={INVOICE_STATUS[inv.status].tone}>
                  {INVOICE_STATUS[inv.status].label}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
