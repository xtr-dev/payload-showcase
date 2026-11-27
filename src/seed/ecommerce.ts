import type { File, Payload } from 'payload'

import { richText } from '@/lib/richtext'
import type { Coupon, Product } from '@/payload-types'

import { vesselArt, type VesselArtOptions } from './art'
import { PALETTE } from './data'
import type { SeedContext } from './types'

/** Shop collections, in an order that is safe to delete. */
export const SHOP_COLLECTIONS = ['orders', 'carts', 'coupons', 'products', 'categories'] as const

export const CATEGORY_SEEDS = [
  { name: 'Tableware', description: 'Thrown and glazed in the studio, made to be used daily.' },
  { name: 'Tools & clay', description: 'What we use ourselves, for practising at home.' },
  { name: 'Gift sets', description: 'Pieces that wrap well.' },
] as const

type CategoryName = (typeof CATEGORY_SEEDS)[number]['name']

export interface SeedProduct {
  title: string
  summary: string
  description: string[]
  /** Price in cents, VAT included. */
  price: number
  sku: string
  categories: CategoryName[]
  /** Units in stock; ignored when the product has variants, which each carry their own. */
  quantity?: number
  lowStockThreshold?: number
  variants?: Array<{ name: string; inventory: number; price?: number }>
  status?: Product['status']
  art: VesselArtOptions
}

const art = (shape: VesselArtOptions['shape'], glaze: string, body: string): VesselArtOptions => ({
  shape,
  bg: PALETTE.bisque,
  sun: '#e3c9a8',
  body,
  glaze,
  dip: 0.6,
})

/** The shop's products. Every stock situation the storefront can show appears once. */
export const PRODUCT_SEEDS: SeedProduct[] = [
  {
    title: 'Speckled mug',
    summary: 'Our everyday mug in speckled stoneware, with a handle that fits three fingers.',
    description: [
      'Thrown on the wheel in small batches and glazed by hand, so no two are quite alike. Holds 300 ml.',
      'Dishwasher safe. The cobalt glaze takes a second firing, which is why it costs a little more.',
    ],
    price: 2800,
    sku: 'KC-MUG',
    categories: ['Tableware', 'Gift sets'],
    lowStockThreshold: 3,
    variants: [
      { name: 'Oat', inventory: 12 },
      { name: 'Celadon', inventory: 8 },
      { name: 'Cobalt', inventory: 3, price: 3200 },
    ],
    art: art('mug', '#e6dccb', '#a0583d'),
  },
  {
    title: 'Breakfast bowl',
    summary: 'A deep bowl for porridge, soup or noodles, glazed celadon inside and out.',
    description: [
      'Wide enough for a proper breakfast and deep enough for ramen. About 15 cm across.',
      'Dishwasher and microwave safe.',
    ],
    price: 3400,
    sku: 'KC-BOWL',
    categories: ['Tableware'],
    quantity: 15,
    lowStockThreshold: 3,
    art: art('bowl', PALETTE.celadon, '#9c5a3c'),
  },
  {
    title: 'Ochre serving plate',
    summary: 'A one-off serving plate from last month’s wood firing. There is only this one.',
    description: [
      'Fired for two days in the wood kiln, which left ash marks across the ochre glaze. 32 cm across.',
      'Hand wash only.',
    ],
    price: 7800,
    sku: 'KC-PLATE-1',
    categories: ['Tableware', 'Gift sets'],
    quantity: 1,
    art: art('plate', PALETTE.ochre, '#b77a55'),
  },
  {
    title: 'Kiln-door vase',
    summary: 'A tall vase shaped after the arch of our kiln door. Back after the next firing.',
    description: [
      'Each batch sells out within days. The next one comes out of the kiln at the end of the month.',
      'About 24 cm tall, glazed inside so it holds water.',
    ],
    price: 9500,
    sku: 'KC-VASE',
    categories: ['Tableware', 'Gift sets'],
    quantity: 0,
    art: art('vase', PALETTE.glaze, PALETTE.terracotta),
  },
  {
    title: 'Trimming tool set',
    summary: 'The five tools we hand every beginner: wire, rib, sponge, needle and loop tool.',
    description: [
      'The same set you use in class, in a canvas roll. Everything you need to throw and trim at home.',
    ],
    price: 2450,
    sku: 'KC-TOOLS',
    categories: ['Tools & clay', 'Gift sets'],
    quantity: 25,
    lowStockThreshold: 3,
    art: art('tumbler', PALETTE.cobalt, '#c2a68a'),
  },
  {
    title: 'Stoneware clay 5 kg',
    summary: 'The speckled stoneware we throw with, in a 5 kg bag. Fires to 1240 °C.',
    description: [
      'Smooth enough for the wheel, with enough grog for hand-building. Members can fire it in our kilns.',
    ],
    price: 1650,
    sku: 'KC-CLAY-5',
    categories: ['Tools & clay'],
    quantity: 4,
    lowStockThreshold: 5,
    art: art('jar', '#c9b79f', '#8a6a52'),
  },
  {
    title: 'Raku tea bowl (draft)',
    summary: 'Not announced yet: tea bowls from the raku weekend.',
    description: ['Draft products stay out of the shop until they are set to active.'],
    price: 4200,
    sku: 'KC-RAKU',
    categories: ['Tableware'],
    quantity: 6,
    status: 'draft',
    art: art('bowl', PALETTE.umber, '#b77a55'),
  },
]

type CouponSeed = Pick<Coupon, 'code' | 'type'> &
  Partial<Pick<Coupon, 'description' | 'value' | 'minPurchase' | 'customerLimit'>>

/** Coupon codes; amounts are in cents. */
export const COUPON_SEEDS: CouponSeed[] = [
  { code: 'WELCOME10', type: 'percentage', value: 10, description: '10% off any order.' },
  {
    code: 'STUDIO5',
    type: 'fixed',
    value: 500,
    minPurchase: 4000,
    customerLimit: 1,
    description: '€5 off orders from €40, once per member.',
  },
  { code: 'FREESHIP', type: 'freeShipping', description: 'Free shipping on any order.' },
]

const svgFile = (name: string, svg: string): File => {
  const data = Buffer.from(svg, 'utf8')
  return { name, data, mimetype: 'image/svg+xml', size: data.byteLength }
}

/**
 * Seed data for the shop: categories, products with their illustrations, and coupon codes.
 * Carts and orders start empty. Product images live in `media`, which the core seed clears.
 */
export const seedEcommerce = async (
  payload: Payload,
  _ctx: SeedContext,
  { reset }: { reset: boolean },
): Promise<void> => {
  if (reset) {
    for (const collection of SHOP_COLLECTIONS) {
      await payload.delete({ collection, where: { id: { exists: true } } })
    }
  }

  const categoryIds = new Map<CategoryName, number>()
  for (const category of CATEGORY_SEEDS) {
    const doc = await payload.create({ collection: 'categories', data: { ...category } })
    categoryIds.set(category.name, doc.id)
  }

  for (const product of PRODUCT_SEEDS) {
    const image = await payload.create({
      collection: 'media',
      data: { alt: `Illustration of the ${product.title.toLowerCase()}` },
      file: svgFile(`shop-${product.sku.toLowerCase()}.svg`, vesselArt(product.art)),
    })
    await payload.create({
      collection: 'products',
      data: {
        title: product.title,
        summary: product.summary,
        description: richText(...product.description),
        price: product.price,
        sku: product.sku,
        status: product.status ?? 'active',
        images: [image.id],
        categories: product.categories.map((name) => categoryIds.get(name)!),
        inventory: {
          trackQuantity: true,
          quantity: product.quantity ?? 0,
          lowStockThreshold: product.lowStockThreshold,
        },
        variants: product.variants?.map((variant) => ({
          ...variant,
          sku: `${product.sku}-${variant.name.toUpperCase()}`,
        })),
      },
    })
  }

  for (const coupon of COUPON_SEEDS) {
    await payload.create({ collection: 'coupons', data: { ...coupon, status: 'active' } })
  }
  payload.logger.info(
    `Seeded ${PRODUCT_SEEDS.length} products, ${CATEGORY_SEEDS.length} categories and ${COUPON_SEEDS.length} coupons.`,
  )
}
