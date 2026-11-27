'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'

import { getVisitorId, isEnabled } from '@/lib/flags'
import { getPayloadClient } from '@/lib/payload'
import { addToCart, setCartLineQuantity, ShopError, toCartSession } from '@/lib/shop'

export interface CartFormState {
  error?: string
  /** Set after a successful add, so the form can confirm it. */
  added?: string
}

/**
 * The cart every action works on is the one stored under the visitor's own `kiln_vid` cookie
 * (httpOnly, set by src/proxy.ts). No action accepts a cart id, so a visitor cannot reach
 * another visitor's cart.
 */
const cartSession = async (): Promise<string> => {
  if (!(await isEnabled('shop'))) notFound()
  const sessionId = toCartSession(await getVisitorId())
  if (!sessionId) throw new ShopError('Your cart needs cookies. Allow them and reload the page.')
  return sessionId
}

const message = (error: unknown): string =>
  error instanceof ShopError ? error.message : 'Something went wrong. Please try again.'

/** Re-renders every page, so the header's cart count follows the cart. */
const refresh = () => revalidatePath('/', 'layout')

/** Adds the chosen product (and glaze) to the visitor's cart. */
export async function addToCartAction(
  _prev: CartFormState,
  formData: FormData,
): Promise<CartFormState> {
  try {
    const sessionId = await cartSession()
    await addToCart(await getPayloadClient(), sessionId, {
      productId: formData.get('productId'),
      variant: formData.get('variant'),
      quantity: formData.get('quantity'),
    })
  } catch (error) {
    if (!(error instanceof ShopError)) throwIfNextControlFlow(error)
    return { error: message(error) }
  }
  refresh()
  return { added: new Date().toISOString() }
}

/** Changes the quantity of a line in the visitor's cart; a quantity of 0 removes it. */
export async function updateCartLineAction(
  _prev: CartFormState,
  formData: FormData,
): Promise<CartFormState> {
  try {
    const sessionId = await cartSession()
    await setCartLineQuantity(await getPayloadClient(), sessionId, {
      productId: formData.get('productId'),
      variant: formData.get('variant'),
      quantity: formData.get('intent') === 'remove' ? 0 : formData.get('quantity'),
    })
  } catch (error) {
    if (!(error instanceof ShopError)) throwIfNextControlFlow(error)
    return { error: message(error) }
  }
  refresh()
  return {}
}

/** Lets Next.js see its own notFound/redirect errors, which carry a `digest`. */
function throwIfNextControlFlow(error: unknown): void {
  if (error && typeof error === 'object' && 'digest' in error) throw error
}
