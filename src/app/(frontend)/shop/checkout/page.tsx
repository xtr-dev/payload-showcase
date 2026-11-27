import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { CheckoutForm } from '@/components/shop/CheckoutForm'
import { OrderSummary } from '@/components/shop/OrderSummary'
import { Card, Container } from '@/components/ui'
import { getCurrentUser } from '@/lib/auth'
import { getVisitorId, isEnabled } from '@/lib/flags'
import { formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import { getCartView, quoteCart, SHIPPING_COUNTRIES, toCartSession } from '@/lib/shop'

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * Checkout for the visitor's cart, signed in or as a guest. The summary is a preview: the order
 * and its amounts are created on the server when the form is submitted.
 */
export default async function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await isEnabled('shop'))) notFound()
  const { code } = await searchParams
  const typedCode = typeof code === 'string' ? code.trim().slice(0, 40) : ''

  const payload = await getPayloadClient()
  const sessionId = toCartSession(await getVisitorId())
  const cart = sessionId ? await getCartView(payload, sessionId) : null
  if (!cart || cart.lines.length === 0 || cart.blocked) redirect('/shop/cart')

  const user = await getCurrentUser()
  const quote = await quoteCart(payload, cart, { couponCode: typedCode, user })
  // A code that does not apply (any more) is sorted out on the cart page, which explains why.
  if (quote.couponError) redirect(`/shop/cart?code=${encodeURIComponent(typedCode)}`)

  const [firstName, ...rest] = (user?.name ?? '').split(' ')
  const here = `/shop/checkout${quote.coupon ? `?code=${quote.coupon.code}` : ''}`

  return (
    <Container className="py-12 lg:py-16">
      <nav aria-label="Breadcrumb" className="mb-8 text-sm">
        <ol className="flex flex-wrap gap-2 text-ink-soft">
          <li>
            <Link href="/shop" className="font-medium text-clay hover:underline">
              Shop
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href="/shop/cart" className="font-medium text-clay hover:underline">
              Cart
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="font-medium text-ink">
            Checkout
          </li>
        </ol>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
        <Card
          as="section"
          tone="bisque"
          className="p-6 sm:p-8 lg:self-start"
          aria-labelledby="order-heading"
        >
          <p className="text-sm font-semibold tracking-[0.14em] text-clay uppercase">Your order</p>
          <h1 id="order-heading" className="mt-2 text-3xl text-ink sm:text-4xl">
            Checkout
          </h1>
          <ul
            className="mt-6 divide-y divide-line border-y border-line"
            data-testid="checkout-lines"
          >
            {cart.lines.map((line) => (
              <li key={line.key} className="flex justify-between gap-4 py-3 text-sm">
                <span>
                  <span className="font-semibold text-ink">
                    {line.quantity} × {line.product.title}
                  </span>
                  {line.variant && <span className="text-ink-soft"> · {line.variant}</span>}
                </span>
                <span className="font-semibold">{formatPrice(line.total)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <OrderSummary {...quote} couponCode={quote.coupon?.code} />
          </div>
        </Card>

        <div>
          <h2 className="text-2xl text-ink">Where should it go?</h2>
          <p className="mt-2 mb-6 text-ink-soft">
            {user ? (
              <>
                Signed in as {user.email}. You will find this order under{' '}
                <Link
                  href="/account"
                  className="font-medium text-clay underline underline-offset-4"
                >
                  My studio
                </Link>
                .
              </>
            ) : (
              <>
                Checking out as a guest.{' '}
                <Link
                  href={`/login?next=${encodeURIComponent(here)}`}
                  className="font-medium text-clay underline underline-offset-4"
                >
                  Sign in
                </Link>{' '}
                to keep your orders in one place.
              </>
            )}
          </p>
          <CheckoutForm
            guest={!user}
            couponCode={quote.coupon?.code}
            totalLabel={formatPrice(quote.total)}
            countries={SHIPPING_COUNTRIES}
            defaults={{ firstName, lastName: rest.join(' ') }}
          />
        </div>
      </div>
    </Container>
  )
}
