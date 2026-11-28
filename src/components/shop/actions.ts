'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth'
import { getVisitorId, isEnabled } from '@/lib/flags'
import { getPayloadClient } from '@/lib/payload'
import {
  addToCart,
  CheckoutError,
  getOrderForVisitor,
  placeOrder,
  restoreCartFromOrder,
  setCartLineQuantity,
  ShopError,
  toCartSession,
  type CheckoutField,
  type CheckoutValues,
} from '@/lib/shop'

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

export interface CheckoutFormState {
  error?: string
  /** Messages per input, when the form was filled in wrongly. */
  fieldErrors?: CheckoutValues
  /** What the customer typed, so the form can be shown again without losing it. */
  values?: CheckoutValues
}

const CHECKOUT_FIELDS: CheckoutField[] = [
  'email',
  'firstName',
  'lastName',
  'address1',
  'address2',
  'postalCode',
  'city',
  'country',
]

/**
 * Places the order for the visitor's cart and sends them to the payment page. The form supplies
 * an address, an email for guests and a coupon code; the cart, the prices and the totals are
 * taken from the server (see `placeOrder`). Works signed in or as a guest.
 */
export async function placeOrderAction(
  _prev: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  const values: CheckoutValues = {}
  for (const field of CHECKOUT_FIELDS) {
    const value = formData.get(field)
    if (typeof value === 'string') values[field] = value.slice(0, 300)
  }
  let redirectTo: string
  try {
    const sessionId = await cartSession()
    const user = await getCurrentUser()
    ;({ redirectTo } = await placeOrder(await getPayloadClient(), sessionId, user, {
      ...values,
      couponCode: formData.get('couponCode'),
    }))
  } catch (error) {
    if (error instanceof CheckoutError) {
      return { error: error.message, fieldErrors: error.fields, values }
    }
    if (!(error instanceof ShopError)) throwIfNextControlFlow(error)
    return { error: message(error), values }
  }
  refresh()
  redirect(redirectTo)
}

/**
 * Puts a cancelled order's items back in the visitor's cart (after a payment that did not go
 * through) and opens the cart. The order is named by its number plus its access token, or belongs to the
 * signed-in member; see `getOrderForVisitor`.
 */
export async function restoreCartAction(formData: FormData): Promise<void> {
  const sessionId = await cartSession()
  const payload = await getPayloadClient()
  const order = await getOrderForVisitor(payload, formData.get('orderNumber'), {
    token: formData.get('token'),
    user: await getCurrentUser(),
  })
  if (!order) notFound()
  await restoreCartFromOrder(payload, sessionId, order).catch((error) => {
    if (!(error instanceof ShopError)) throw error
  })
  refresh()
  redirect('/shop/cart')
}

/** Lets Next.js see its own notFound/redirect errors, which carry a `digest`. */
function throwIfNextControlFlow(error: unknown): void {
  if (error && typeof error === 'object' && 'digest' in error) throw error
}
