import Link from 'next/link'

import { Badge, MediaImage } from '@/components/ui'
import { asMedia, formatPrice } from '@/lib/format'
import { priceRange, type Stock } from '@/lib/shop'
import type { Product } from '@/payload-types'

import { StockBadge } from './StockBadge'

/** A product in the shop grid. Mirrors WorkshopCard: the title link covers the whole card. */
export const ProductCard = ({ product, stock }: { product: Product; stock: Stock }) => {
  const image = asMedia(product.images?.[0])
  const category = product.categories?.find((c) => typeof c === 'object')
  const price = priceRange(product)
  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-card border border-line/70 bg-white/70 shadow-card transition duration-300 ease-out-soft hover:-translate-y-1 hover:shadow-lift"
      data-testid="product"
    >
      <div className="aspect-[4/3] overflow-hidden bg-sand">
        <MediaImage
          media={image}
          className="transition-transform duration-500 ease-out-soft group-hover:scale-[1.04]"
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <div className="flex flex-wrap gap-2">
          {category && typeof category === 'object' && <Badge>{category.name}</Badge>}
          <StockBadge stock={stock} />
        </div>
        <h2 className="text-2xl leading-snug text-ink">
          {/* The link covers the whole card; the title stays the accessible name. */}
          <Link
            href={`/shop/${product.slug}`}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-card focus-visible:after:outline-3 focus-visible:after:outline-cobalt"
          >
            {product.title}
          </Link>
        </h2>
        <p className="text-ink-soft">{product.summary}</p>
        <div className="mt-auto flex items-end justify-between border-t border-dashed border-line pt-4">
          <p className="text-sm text-ink-soft">
            {product.variants?.length ? `${product.variants.length} glazes` : 'Made in the studio'}
          </p>
          <p className="font-display text-2xl font-semibold text-clay">
            {price.varies && <span className="text-base font-normal text-ink-soft">from </span>}
            {formatPrice(price.from)}
          </p>
        </div>
      </div>
    </article>
  )
}
