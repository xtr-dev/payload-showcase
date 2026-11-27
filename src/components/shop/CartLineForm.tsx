'use client'

import { useActionState } from 'react'

import { Button, SelectField } from '@/components/ui'

import { updateCartLineAction, type CartFormState } from './actions'

/**
 * Quantity and remove controls of one cart line. The line is named by product and glaze; which
 * cart it belongs to is decided on the server from the visitor's cookie.
 */
export const CartLineForm = ({
  productId,
  variant,
  quantity,
  maxQuantity,
  label,
}: {
  productId: number
  variant: string | null
  quantity: number
  /** Highest quantity offered: the per-line cap or what is left in stock. */
  maxQuantity: number
  /** Product name with glaze, for the controls' accessible names. */
  label: string
}) => {
  const [state, action, pending] = useActionState<CartFormState, FormData>(updateCartLineAction, {})
  const id = `quantity-${productId}-${(variant ?? '').replace(/\W+/g, '-')}`
  const choices = Array.from({ length: Math.max(maxQuantity, 0) }, (_, i) => i + 1)
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variant" value={variant ?? ''} />
      {choices.length > 0 && (
        <>
          <SelectField
            id={id}
            name="quantity"
            label="Quantity"
            aria-label={`Quantity of ${label}`}
            defaultValue={String(Math.min(quantity, maxQuantity))}
            key={quantity}
            className="w-24"
          >
            {choices.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="outline" disabled={pending} aria-label={`Update ${label}`}>
            Update
          </Button>
        </>
      )}
      <Button
        type="submit"
        name="intent"
        value="remove"
        variant="ghost"
        disabled={pending}
        aria-label={`Remove ${label}`}
      >
        Remove
      </Button>
      {state.error && (
        <p role="alert" className="w-full text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
    </form>
  )
}
