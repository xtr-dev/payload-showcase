import { ButtonLink, Card } from '@/components/ui'
import { formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import { FREE_SHIPPING_FROM, SHIPPING_FLAT, STALE_ORDER_MINUTES } from '@/lib/shop'

import { ShowcaseSection } from '../ShowcaseSection'

const STEPS = [
  [
    'Cart',
    'Adding a mug creates a cart for the browser’s visitor cookie. The plugin’s helpers keep its lines and subtotal; the site never takes a cart id or a price from the request.',
  ],
  [
    'Checkout',
    'A guest or a member gives an address. The plugin turns the cart into an order: it prices the lines from the products, applies the coupon and takes the stock.',
  ],
  [
    'Pay',
    'The order gets an invoice and a payment from payload-billing. When the payment succeeds, a hook marks the order paid; when it fails, the order is cancelled and the plugin restocks it.',
  ],
  [
    'Tell',
    'A paid order is confirmed by email (payload-mailing). When an admin sets it to shipped, the member hears about it in their inbox (payload-notifications).',
  ],
  [
    'Watch',
    `Two payload-automation workflows keep an eye on the shelf: one warns the admin when a sold product runs low, the other releases orders left unpaid for ${STALE_ORDER_MINUTES} minutes.`,
  ],
] as const

/** Live numbers from the shop, without any personal data. */
const getTotals = async () => {
  const payload = await getPayloadClient()
  const [products, paid, coupons] = await Promise.all([
    payload.find({
      collection: 'products',
      where: { status: { equals: 'active' } },
      limit: 0,
      pagination: false,
      depth: 0,
      select: { inventory: true, variants: true },
    }),
    payload.count({ collection: 'orders', where: { paymentStatus: { equals: 'paid' } } }),
    payload.count({ collection: 'coupons', where: { status: { equals: 'active' } } }),
  ])
  const inStock = products.docs.reduce(
    (sum, product) =>
      sum +
      (product.variants?.length
        ? product.variants.reduce((n, variant) => n + (variant.inventory ?? 0), 0)
        : (product.inventory?.quantity ?? 0)),
    0,
  )
  return {
    products: products.docs.length,
    inStock,
    paidOrders: paid.totalDocs,
    coupons: coupons.totalDocs,
  }
}

/** Showcase for @xtr-dev/payload-ecommerce. */
export const EcommerceShowcase = async () => {
  const totals = await getTotals().catch(() => null)
  return (
    <ShowcaseSection
      id="ecommerce"
      pkg="@xtr-dev/payload-ecommerce"
      title="A studio shop"
      intro="Mugs, bowls, tools and clay: products with glazes and stock, a cart for guests and members, discount codes and orders, wired to the other five plugins."
      features={[
        'Products with variants that carry their own price and stock, and categories to browse by',
        'A cart per browser that works without an account, changed only through server actions',
        'Orders created from the cart on the server: prices, coupon and stock are the plugin’s work',
        'Coupons: a percentage, a fixed amount with a minimum, and free shipping',
        'Stock that is taken when an order is placed and put back when it is cancelled or refunded',
        'Secure defaults: the public reads active products only; carts, orders and coupons are closed',
        `Integer cents with VAT included, flat ${formatPrice(SHIPPING_FLAT)} shipping and free from ${formatPrice(FREE_SHIPPING_FROM)}`,
      ]}
      usedOn={[
        ['Shop', '/shop'],
        ['Cart', '/shop/cart'],
        ['My studio', '/account'],
        ['Orders (admin)', '/admin/collections/orders'],
      ]}
      status="live"
      tone="bisque"
    >
      <Card className="p-6 sm:p-8" data-testid="ecommerce-showcase">
        <h3 className="font-display text-2xl text-ink">From cart to doorstep</h3>
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
          <dl className="mt-8 grid grid-cols-2 gap-4 border-t border-line pt-6 text-center sm:grid-cols-4">
            <div>
              <dt className="text-sm text-ink-soft">Products for sale</dt>
              <dd className="font-display text-3xl font-semibold text-ink">{totals.products}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Pieces in stock</dt>
              <dd className="font-display text-3xl font-semibold text-ink">{totals.inStock}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Orders paid</dt>
              <dd className="font-display text-3xl font-semibold text-ink">{totals.paidOrders}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Discount codes</dt>
              <dd className="font-display text-3xl font-semibold text-ink">{totals.coupons}</dd>
            </div>
          </dl>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/shop" size="sm">
            Visit the shop
          </ButtonLink>
          <ButtonLink href="/shop/speckled-mug" size="sm" variant="outline">
            Pick a glaze
          </ButtonLink>
        </div>

        <p className="mt-6 text-sm text-ink-soft">
          Try <code className="font-mono">WELCOME10</code> for 10% off,{' '}
          <code className="font-mono">FREESHIP</code> for free shipping, or sign in and use{' '}
          <code className="font-mono">STUDIO5</code> (€5 off from €40, once per member). The
          Kiln-door vase is sold out and there is one Ochre serving plate left, so you can see what
          the shop does when stock runs out. Payment goes through the test provider: no real money
          moves.
        </p>
      </Card>
    </ShowcaseSection>
  )
}
