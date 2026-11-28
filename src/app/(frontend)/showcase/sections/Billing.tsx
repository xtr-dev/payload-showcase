import Link from 'next/link'

import { Badge, ButtonLink, Card } from '@/components/ui'
import { formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import { checkoutProvider } from '@/plugins/billing'

import { ShowcaseSection } from '../ShowcaseSection'

const STEPS = [
  ['Reserve', 'Booking a seat creates a pending booking that holds the seat.'],
  [
    'Pay',
    'Checkout creates an open invoice and a payment. The plugin asks the provider for a checkout page and the visitor goes there.',
  ],
  [
    'Return',
    'The provider sends the visitor back to /checkout/return with the payment’s return token. The page waits until the provider reports the result.',
  ],
  [
    'Confirm',
    'The payment turns succeeded and the invoice paid. A hook on payments marks the booking paid, or activates the membership.',
  ],
  [
    'Refund',
    'An admin refunds the booking from its admin page. The payment becomes refunded, the booking too, and the seat goes back on sale.',
  ],
] as const

/** Live totals across the demo, without any personal data. */
const getTotals = async () => {
  const payload = await getPayloadClient()
  const count = (collection: 'payments' | 'invoices' | 'refunds', status: string) =>
    payload
      .count({ collection, where: { status: { equals: status } }, overrideAccess: true })
      .then((r) => r.totalDocs)
  const [paid, refunded, partly, invoicesPaid, refunds] = await Promise.all([
    count('payments', 'succeeded'),
    count('payments', 'refunded'),
    count('payments', 'partially_refunded'),
    count('invoices', 'paid'),
    payload.find({
      collection: 'refunds',
      where: { status: { equals: 'succeeded' } },
      limit: 0,
      pagination: false,
      depth: 0,
      overrideAccess: true,
      select: { amount: true },
    }),
  ])
  return {
    payments: paid + refunded + partly,
    invoicesPaid,
    refunded: refunds.docs.reduce((sum, r) => sum + (r.amount ?? 0), 0),
  }
}

/** Showcase for @xtr-dev/payload-billing. */
export const BillingShowcase = async () => {
  const totals = await getTotals().catch(() => null)
  const provider = checkoutProvider()
  return (
    <ShowcaseSection
      id="billing"
      pkg="@xtr-dev/payload-billing"
      title="Bookings and memberships, paid"
      intro="Every workshop seat and membership goes through a real checkout, with payments, invoices and refunds tracked in Payload."
      features={[
        'Local test provider out of the box; Mollie with an API key, Stripe webhooks with a Stripe key',
        'An invoice and a payment for each booking, membership month and shop order',
        'Shop invoices list the items at their normal prices, with a coupon as the invoice’s discount',
        'Guest invoices carry the name and email from checkout; a member’s are copied from their account',
        'A return page that finds the payment by its return token',
        'Admin refunds that release the seat back to the session',
        'Members see only their own payments and invoices',
      ]}
      usedOn={[
        ['Workshop booking', '/workshops'],
        ['Membership', '/membership'],
        ['My studio', '/account'],
      ]}
      status="live"
      tone="paper"
    >
      <Card className="p-6 sm:p-8" data-testid="billing-showcase">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-2xl text-ink">How a booking is paid</h3>
          <Badge tone="glaze">Checkout: {provider === 'test' ? 'test provider' : 'Mollie'}</Badge>
        </div>
        <ol className="mt-6 space-y-4">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="grid grid-cols-[2rem_1fr] gap-3">
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-pill bg-clay-soft font-semibold text-clay-deep"
              >
                {i + 1}
              </span>
              <p className="text-ink-soft">
                <span className="font-semibold text-ink">{title}.</span> {text}
              </p>
            </li>
          ))}
        </ol>

        {totals && (
          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-line pt-6 text-center">
            <div>
              <dt className="text-sm text-ink-soft">Payments taken</dt>
              <dd className="font-display text-3xl font-semibold text-ink">{totals.payments}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Invoices paid</dt>
              <dd className="font-display text-3xl font-semibold text-ink">
                {totals.invoicesPaid}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Refunded</dt>
              <dd className="font-display text-3xl font-semibold text-ink">
                {formatPrice(totals.refunded)}
              </dd>
            </div>
          </dl>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/workshops" size="sm">
            Book a workshop
          </ButtonLink>
          <ButtonLink href="/account" size="sm" variant="outline">
            See payments in My studio
          </ButtonLink>
        </div>

        <p className="mt-6 text-sm text-ink-soft">
          The test provider is simulated: its checkout page lets you pick a payment method and an
          outcome (paid, declined, cancelled…) and no money moves. Sign in as{' '}
          <code className="font-mono">mara@kiln.test</code> for a payment history with a partial
          refund, or as <code className="font-mono">admin@kiln.test</code> and open a paid booking
          in the{' '}
          <Link
            href="/admin/collections/bookings"
            className="font-medium text-clay hover:underline"
          >
            admin
          </Link>{' '}
          to refund it. Set <code className="font-mono">MOLLIE_API_KEY</code> to check out through
          Mollie instead. Stripe is wired for its webhooks only: its provider returns a
          PaymentIntent that needs a Stripe.js payment form, which this demo doesn’t ship.
        </p>
      </Card>
    </ShowcaseSection>
  )
}
