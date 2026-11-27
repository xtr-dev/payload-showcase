import { payloadEcommerce, type CollectionExtender } from '@xtr-dev/payload-ecommerce'
import type { Plugin } from 'payload'

import { getUser, isAdminUser } from '@/access'

/**
 * @xtr-dev/payload-ecommerce
 *
 * The studio shop: products with variants and stock, categories, carts, coupons and orders.
 *
 * - Prices are integer cents including VAT, like every other amount on the site, so the plugin
 *   rounds with `Math.round` and no `calculateTax` hook is set: an order's `tax` stays 0 and its
 *   total is what the customer pays.
 * - Access is the plugin's default, with the site's own admin check: everyone reads active
 *   products and categories, coupons are admin-only, a member reads their own orders, and guest
 *   carts and orders are reachable only from server code. The storefront therefore goes through
 *   src/lib/shop.ts, which only ever uses the cart of the visitor's own session cookie.
 * - Each collection is extended with a function rather than edited afterwards, because the plugin
 *   builds its collections twice; the functions below only return new objects.
 */

/** Puts a plugin collection under "Shop" in the admin navigation. */
const inShopGroup: CollectionExtender = (collection) => ({
  ...collection,
  admin: { ...collection.admin, group: 'Shop' },
})

/** Products get a one-line `summary`, shown on the shop's product cards and as meta description. */
const extendProducts: CollectionExtender = (collection) => {
  const [title, ...rest] = collection.fields
  return {
    ...inShopGroup(collection),
    fields: [
      title,
      {
        name: 'summary',
        type: 'textarea',
        maxLength: 200,
        admin: { description: 'One or two sentences for the product card.' },
      },
      ...rest,
    ],
  }
}

export const ecommerce: Plugin[] = [
  payloadEcommerce({
    userCollection: 'users',
    mediaCollection: 'media',
    isAdmin: ({ req }) => isAdminUser(getUser(req)),
    roundMoney: Math.round,
    collections: {
      products: extendProducts,
      categories: inShopGroup,
      orders: inShopGroup,
      carts: inShopGroup,
      coupons: inShopGroup,
    },
  }),
]
