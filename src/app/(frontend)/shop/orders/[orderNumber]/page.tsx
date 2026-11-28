import { syncPaymentFromProvider } from '@xtr-dev/payload-billing'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ReturnPoller } from '@/components/billing/ReturnPoller'
import { restoreCartAction } from '@/components/shop/actions'
import { OrderSummary } from '@/components/shop/OrderSummary'
import { ORDER_STATUS } from '@/components/shop/orderStatus'
import { Alert, Badge, Button, ButtonLink, Card, Container } from '@/components/ui'
import { getCurrentUser } from '@/lib/auth'
import { paymentLink } from '@/lib/checkout'
import { isEnabled } from '@/lib/flags'
import { formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import { getOrderForVisitor, includedVat, orderLineLabel, SHIPPING_COUNTRIES } from '@/lib/shop'
import type { Order } from '@/payload-types'

// The URL can carry the order's access token, so it is never sent on to other sites as a referrer.
export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false },
  referrer: 'no-referrer',
}

const HEADINGS: Record<Order['status'], string> = {
  pending: 'Confirming your payment…',
  processing: 'Thank you, your order is in!',
  shipped: 'Your order is on its way',
  delivered: 'Your order has arrived',
  cancelled: 'Your payment didn’t go through',
  refunded: 'This order was refunded',
}

/**
 * An order's confirmation and status page, and where the payment provider sends the customer
 * back to. It is shown to whoever holds the order's access token (`?t=…`, which is how a guest
 * gets back to it), to the signed-in member who placed it and to admins; everyone else gets a
 * 404, the same as for an order number that does not exist. While the payment is still open the
 * page polls, like /checkout/return does for bookings.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await isEnabled('shop'))) notFound()
  const { orderNumber } = await params
  const { t: token } = await searchParams
  const payload = await getPayloadClient()
  const user = await getCurrentUser()
  const load = () => getOrderForVisitor(payload, orderNumber, { token, user })

  let order = await load()
  if (!order) notFound()

  const findPayment = async (id: number) =>
    (
      await payload.find({
        collection: 'payments',
        where: { order: { equals: id } },
        sort: '-createdAt',
        depth: 0,
        limit: 1,
      })
    ).docs[0]
  let payment = await findPayment(order.id)
  // A Mollie payment whose webhook cannot reach this server (e.g. on localhost) is pulled.
  if (order.status === 'pending' && payment?.provider === 'mollie') {
    await syncPaymentFromProvider(payload, payment.id).catch(() => null)
    order = (await load()) ?? order
    payment = await findPayment(order.id)
  }

  const status = ORDER_STATUS[order.status]
  const open = order.status === 'pending'
  const address = order.shippingAddress
  const country = SHIPPING_COUNTRIES.find((c) => c.code === address?.country)?.name
  const isOwner =
    !!user && (typeof order.user === 'object' ? order.user?.id : order.user) === user.id
  const invoiceId = typeof payment?.invoice === 'object' ? payment.invoice?.id : payment?.invoice
  const coupon = typeof order.coupon === 'object' ? order.coupon : null

  return (
    <Container narrow className="py-14 lg:py-20">
      {open && <ReturnPoller />}
      <p className="text-sm font-semibold tracking-[0.14em] text-clay uppercase">Studio shop</p>
      <h1 className="mt-2 text-4xl text-ink sm:text-5xl" data-testid="order-heading">
        {HEADINGS[order.status]}
      </h1>

      <Card className="mt-8 p-6 sm:p-8" data-testid="order-result">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-ink-soft">Order</p>
            <p className="font-mono font-semibold text-ink" data-testid="order-number">
              {order.orderNumber}
            </p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <ul className="mt-6 divide-y divide-line border-y border-line">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4 py-3 text-sm">
              <span className="font-semibold text-ink">
                {item.quantity} × {orderLineLabel(item)}
              </span>
              <span className="font-semibold">{formatPrice(item.total)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <OrderSummary
            subtotal={order.subtotal}
            discount={order.discount ?? 0}
            shipping={order.shipping ?? 0}
            total={order.total}
            vat={includedVat(order.total)}
            couponCode={coupon?.code}
          />
        </div>

        <dl className="mt-6 grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-soft">Ships to</dt>
            <dd className="font-semibold">
              {address?.firstName} {address?.lastName}
            </dd>
            <dd>
              {address?.address1}
              {address?.address2 ? `, ${address.address2}` : ''}
            </dd>
            <dd>
              {address?.postalCode} {address?.city}
              {country ? `, ${country}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">
              {order.paymentStatus === 'paid' ? 'Confirmation sent to' : 'Email'}
            </dt>
            <dd className="font-semibold break-all">{order.customerEmail}</dd>
            {order.trackingNumber && (
              <>
                <dt className="mt-3 text-ink-soft">Tracking</dt>
                <dd className="font-mono font-semibold">{order.trackingNumber}</dd>
              </>
            )}
          </div>
        </dl>

        {open && (
          <p className="mt-6 text-sm text-ink-soft" role="status">
            Waiting for the payment provider to confirm. This page updates by itself.
          </p>
        )}
        {order.status === 'processing' && (
          <Alert tone="success" className="mt-6">
            We’re wrapping it in far too much paper. You’ll hear from us when it ships.
          </Alert>
        )}
        {order.status === 'cancelled' && (
          <Alert tone="warning" className="mt-6">
            Nothing was charged and the order was cancelled, so its items are back on the shelf.
          </Alert>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          {open && payment?.status === 'pending' && (
            <ButtonLink href={paymentLink(payment)}>Pay now</ButtonLink>
          )}
          {order.status === 'cancelled' && (
            <form action={restoreCartAction}>
              <input type="hidden" name="orderNumber" value={order.orderNumber ?? ''} />
              <input type="hidden" name="token" value={typeof token === 'string' ? token : ''} />
              <Button type="submit">Put it back in my cart</Button>
            </form>
          )}
          <ButtonLink
            href="/shop"
            variant={open || order.status === 'cancelled' ? 'outline' : 'primary'}
          >
            Back to the shop
          </ButtonLink>
          {isOwner && (
            <ButtonLink href="/account" variant="ghost">
              Go to My studio
            </ButtonLink>
          )}
          {isOwner && invoiceId && order.paymentStatus === 'paid' && (
            <ButtonLink href={`/account/invoices/${invoiceId}`} variant="ghost">
              View invoice
            </ButtonLink>
          )}
        </div>
      </Card>

      <p className="mt-6 text-sm text-ink-soft">
        Orders on this demo are created by{' '}
        <Link href="/showcase#ecommerce" className="font-medium text-clay hover:underline">
          payload-ecommerce
        </Link>{' '}
        and paid through payload-billing
        {payment?.provider === 'test' ? '’s test provider: no real money moves.' : '.'}
      </p>
    </Container>
  )
}
