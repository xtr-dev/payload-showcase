import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ProductCard } from '@/components/shop/ProductCard'
import { Alert, Container, SectionHeading } from '@/components/ui'
import { isEnabled } from '@/lib/flags'
import { formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import {
  FREE_SHIPPING_FROM,
  getShopCategories,
  getStock,
  SHIPPING_FLAT,
  summariseStock,
} from '@/lib/shop'

export const metadata: Metadata = {
  title: 'Studio shop',
  description: 'Mugs, bowls and one-off pieces from the Kiln & Co. kilns, plus tools and clay.',
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const pill =
  'inline-flex h-10 items-center rounded-pill border-2 border-line px-4 text-sm font-semibold text-ink-soft transition-colors hover:border-ink-soft/50 hover:text-ink aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-paper'

/** Gated by the `shop` feature flag: returns 404 while the flag is off. */
export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await isEnabled('shop'))) notFound()
  const promo = await isEnabled('shop-free-shipping-banner')
  const { category: categoryParam } = await searchParams
  const payload = await getPayloadClient()
  const categories = await getShopCategories(payload)
  const category = categories.find((c) => c.slug === categoryParam)

  // overrideAccess: false applies the public read rule, so only active products appear here.
  const { docs: products } = await payload.find({
    collection: 'products',
    where: category ? { categories: { contains: category.id } } : undefined,
    sort: 'id',
    depth: 1,
    limit: 50,
    overrideAccess: false,
  })
  const stock = await Promise.all(
    products.map(async (p) => summariseStock(await getStock(payload, p))),
  )

  return (
    <>
      <section className="grain border-b border-line bg-bisque">
        <Container className="py-14 lg:py-20">
          <SectionHeading
            as="h1"
            eyebrow="Studio shop"
            title={
              <>
                Take a piece of the <span className="squiggle">studio home</span>
              </>
            }
            intro={`Made, glazed and fired here in small batches. Shipping is ${formatPrice(SHIPPING_FLAT)}, free from ${formatPrice(FREE_SHIPPING_FROM)}. Prices include VAT.`}
          />
        </Container>
      </section>

      <Container className="py-12 lg:py-16">
        {promo && (
          <div className="mb-8" data-testid="shop-promo">
            <Alert tone="info" title="Free shipping this week">
              Use the code <span className="font-mono font-semibold">FREESHIP</span> in your cart
              and we’ll post any order for free.
            </Alert>
          </div>
        )}
        <nav aria-label="Categories">
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link href="/shop" aria-current={category ? undefined : 'page'} className={pill}>
                Everything
              </Link>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/shop?category=${c.slug}`}
                  aria-current={category?.id === c.id ? 'page' : undefined}
                  className={pill}
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <p className="mt-8 text-ink-soft" aria-live="polite" data-testid="result-count">
          {products.length === 1 ? '1 product' : `${products.length} products`}
          {category ? ` in ${category.name}` : ''}
        </p>

        {products.length > 0 ? (
          <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p, i) => (
              <ProductCard key={p.id} product={p} stock={stock[i]} />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-card border border-dashed border-line p-10 text-center">
            <p className="font-display text-2xl text-ink">The shelves are empty here.</p>
            <p className="mt-2 text-ink-soft">The next firing is on its way.</p>
          </div>
        )}
      </Container>
    </>
  )
}
