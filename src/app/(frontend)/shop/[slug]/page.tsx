import { resolveUnitPrice } from '@xtr-dev/payload-ecommerce'
import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { AddToCartForm, type PurchaseOption } from '@/components/shop/AddToCartForm'
import { StockBadge } from '@/components/shop/StockBadge'
import { Badge, Container, MediaImage } from '@/components/ui'
import { isEnabled } from '@/lib/flags'
import { asMedia, formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import {
  FREE_SHIPPING_FROM,
  getStock,
  MAX_LINE_QUANTITY,
  priceRange,
  SHIPPING_FLAT,
  summariseStock,
  VAT_RATE,
} from '@/lib/shop'

type Params = Promise<{ slug: string }>

const getProduct = cache(async (slug: string) => {
  if (!(await isEnabled('shop'))) return null
  const payload = await getPayloadClient()
  // The public read rule only returns active products, so a draft's URL is a 404.
  const { docs } = await payload.find({
    collection: 'products',
    where: { slug: { equals: slug } },
    depth: 1,
    limit: 1,
    overrideAccess: false,
  })
  return docs[0] ?? null
})

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const product = await getProduct((await params).slug)
  return product ? { title: product.title, description: product.summary ?? undefined } : {}
}

export default async function ProductPage({ params }: { params: Params }) {
  const product = await getProduct((await params).slug)
  if (!product) notFound()

  const stock = await getStock(await getPayloadClient(), product)
  const price = priceRange(product)
  const names = product.variants?.length ? product.variants.map((v) => v.name) : ['']
  const options: PurchaseOption[] = names.map((name) => ({
    name,
    priceLabel: formatPrice(resolveUnitPrice(product, name || undefined)),
    available: stock[name].available,
    stockLabel: stock[name].label,
  }))

  const facts = [
    ['Shipping', `${formatPrice(SHIPPING_FLAT)}, free from ${formatPrice(FREE_SHIPPING_FROM)}`],
    ['Price', `Includes ${VAT_RATE}% VAT`],
    ...(product.sku ? [['Article', product.sku]] : []),
  ]

  return (
    <article>
      <div className="grain border-b border-line bg-bisque">
        <Container className="grid items-center gap-10 py-10 lg:grid-cols-[1.1fr_1fr] lg:py-16">
          <div>
            <nav aria-label="Breadcrumb" className="mb-6 text-sm">
              <ol className="flex flex-wrap gap-2 text-ink-soft">
                <li>
                  <Link href="/shop" className="font-medium text-clay hover:underline">
                    Shop
                  </Link>
                </li>
                <li aria-hidden>/</li>
                <li aria-current="page" className="font-medium text-ink">
                  {product.title}
                </li>
              </ol>
            </nav>
            <div className="flex flex-wrap gap-2">
              {(product.categories ?? []).map((c) =>
                typeof c === 'object' ? <Badge key={c.id}>{c.name}</Badge> : null,
              )}
              <StockBadge stock={summariseStock(stock)} />
            </div>
            <h1 className="mt-4 text-4xl leading-[1.05] text-ink sm:text-5xl lg:text-6xl">
              {product.title}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">{product.summary}</p>
          </div>
          <div className="arch aspect-[4/3] border-[6px] border-white shadow-lift lg:aspect-[5/4]">
            <MediaImage media={asMedia(product.images?.[0])} priority />
          </div>
        </Container>
      </div>

      <Container className="grid gap-12 py-12 lg:grid-cols-[1.4fr_1fr] lg:py-16">
        <div>
          <h2 className="sr-only">About this piece</h2>
          {product.description ? (
            <RichText data={product.description} className="prose-kiln" />
          ) : null}
        </div>

        <aside aria-labelledby="buy-heading" className="space-y-8 lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-card bg-white/70 p-6 shadow-card">
            <h2 id="buy-heading" className="font-display text-3xl font-semibold text-clay">
              {price.varies && <span className="text-lg font-normal text-ink-soft">from </span>}
              {formatPrice(price.from)}
            </h2>
            <div className="mt-5">
              <AddToCartForm
                productId={product.id}
                options={options}
                maxQuantity={MAX_LINE_QUANTITY}
              />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-card bg-white/70 p-6 shadow-card">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-semibold tracking-[0.12em] text-ink-soft uppercase">
                  {label}
                </dt>
                <dd className="mt-1 text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </Container>
    </article>
  )
}
