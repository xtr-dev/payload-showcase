import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CartLineForm } from '@/components/shop/CartLineForm'
import { OrderSummary } from '@/components/shop/OrderSummary'
import { Alert, Button, ButtonLink, Card, Container, MediaImage, TextField } from '@/components/ui'
import { getCurrentUser } from '@/lib/auth'
import { getVisitorId, isEnabled } from '@/lib/flags'
import { formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import {
  FREE_SHIPPING_FROM,
  getCartView,
  MAX_LINE_QUANTITY,
  quoteCart,
  toCartSession,
} from '@/lib/shop'

export const metadata: Metadata = { title: 'Your cart', robots: { index: false } }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * The visitor's cart, found by their `kiln_vid` cookie. A coupon code is tried out with
 * `?code=…`: the page shows what it would do, and checkout applies it to the order.
 */
export default async function CartPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await isEnabled('shop'))) notFound()
  const { code } = await searchParams
  const typedCode = typeof code === 'string' ? code.trim().slice(0, 40) : ''

  const payload = await getPayloadClient()
  const sessionId = toCartSession(await getVisitorId())
  const cart = sessionId ? await getCartView(payload, sessionId) : null

  if (!cart || cart.lines.length === 0) {
    return (
      <Container narrow className="py-14 lg:py-20">
        <p className="text-sm font-semibold tracking-[0.14em] text-clay uppercase">Studio shop</p>
        <h1 className="mt-2 text-4xl text-ink sm:text-5xl">Your cart is empty</h1>
        <p className="mt-4 text-lg text-ink-soft">Nothing on the shelf yet.</p>
        <ButtonLink href="/shop" className="mt-8">
          Browse the shop
        </ButtonLink>
      </Container>
    )
  }

  const user = await getCurrentUser()
  const quote = await quoteCart(payload, cart, { couponCode: typedCode, user })
  const untilFree = FREE_SHIPPING_FROM - cart.subtotal

  return (
    <Container className="py-12 lg:py-16">
      <p className="text-sm font-semibold tracking-[0.14em] text-clay uppercase">Studio shop</p>
      <h1 className="mt-2 text-4xl text-ink sm:text-5xl">Your cart</h1>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <Card as="section" className="p-6 lg:self-start" aria-labelledby="lines-heading">
          <h2 id="lines-heading" className="sr-only">
            Items
          </h2>
          <ul className="divide-y divide-line" data-testid="cart-lines">
            {cart.lines.map((line) => {
              const label = `${line.product.title}${line.variant ? `, ${line.variant}` : ''}`
              return (
                <li key={line.key} className="flex flex-wrap gap-5 py-5 first:pt-0 last:pb-0">
                  <div className="size-24 shrink-0 overflow-hidden rounded-xl bg-sand">
                    <MediaImage media={line.image} sizes="96px" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">
                          <Link
                            href={`/shop/${line.product.slug}`}
                            className="hover:text-clay hover:underline"
                          >
                            {line.product.title}
                          </Link>
                        </p>
                        <p className="text-sm text-ink-soft">
                          {line.variant ? `${line.variant} · ` : ''}
                          {formatPrice(line.unitPrice)} each
                        </p>
                      </div>
                      <p className="font-display text-xl font-semibold text-ink">
                        {formatPrice(line.total)}
                      </p>
                    </div>
                    {line.problem && (
                      <p className="text-sm font-semibold text-danger">{line.problem}</p>
                    )}
                    <CartLineForm
                      productId={line.product.id}
                      variant={line.variant}
                      quantity={line.quantity}
                      maxQuantity={
                        line.product.status === 'active'
                          ? Math.min(MAX_LINE_QUANTITY, line.stock.available ?? MAX_LINE_QUANTITY)
                          : 0
                      }
                      label={label}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          <Card
            as="section"
            tone="bisque"
            className="space-y-6 p-6"
            aria-labelledby="summary-heading"
          >
            <h2 id="summary-heading" className="text-2xl text-ink">
              Summary
            </h2>
            {/* A GET form: the code lives in the URL, so the server checks it on every render. */}
            <form method="get" className="flex items-end gap-2" key={typedCode}>
              <TextField
                id="code"
                label="Discount code"
                defaultValue={quote.coupon?.code ?? typedCode}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="characters"
                aria-invalid={quote.couponError ? true : undefined}
                aria-describedby={quote.couponError ? 'code-error' : undefined}
                className="flex-1"
              />
              <Button type="submit" variant="outline">
                Apply
              </Button>
            </form>
            {quote.couponError && (
              <p id="code-error" role="alert" className="text-sm font-medium text-danger">
                {quote.couponError}
              </p>
            )}
            {quote.coupon && (
              <div data-testid="coupon-applied">
                <Alert tone="success">
                  <span className="font-mono font-semibold">{quote.coupon.code}</span>{' '}
                  {quote.coupon.freeShipping
                    ? 'ships this order for free.'
                    : `takes ${formatPrice(quote.discount)} off.`}{' '}
                  <Link href="/shop/cart" className="underline underline-offset-4">
                    Remove
                  </Link>
                </Alert>
              </div>
            )}
            <OrderSummary {...quote} couponCode={quote.coupon?.code} />
            {quote.shipping > 0 && untilFree > 0 && (
              <p className="text-sm text-ink-soft">
                Add {formatPrice(untilFree)} more for free shipping.
              </p>
            )}
            {cart.blocked && (
              <Alert tone="warning">Change or remove the marked items to check out.</Alert>
            )}
          </Card>
          {cart.blocked ? (
            <Button size="lg" className="w-full" disabled>
              Checkout
            </Button>
          ) : (
            <ButtonLink
              href={`/shop/checkout${quote.coupon ? `?code=${quote.coupon.code}` : ''}`}
              size="lg"
              className="w-full"
            >
              Checkout
            </ButtonLink>
          )}
          <p className="text-sm">
            <Link href="/shop" className="font-medium text-clay hover:underline">
              Keep browsing
            </Link>
          </p>
        </aside>
      </div>
    </Container>
  )
}
