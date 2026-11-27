'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { Alert, Button, SelectField } from '@/components/ui'

import { addToCartAction, type CartFormState } from './actions'

export interface PurchaseOption {
  /** Variant name; the empty string for a product without variants. */
  name: string
  priceLabel: string
  /** Units that can be ordered; null when stock is not tracked. */
  available: number | null
  /** "Sold out", "Only 3 left" or empty. */
  stockLabel: string
}

/**
 * Glaze choice (when the product has variants), quantity and the add-to-cart button. The server
 * action checks the product, variant, quantity and stock again; what is rendered here only
 * decides what the visitor is offered.
 */
export const AddToCartForm = ({
  productId,
  options,
  maxQuantity,
}: {
  productId: number
  options: PurchaseOption[]
  maxQuantity: number
}) => {
  const [state, action, pending] = useActionState<CartFormState, FormData>(addToCartAction, {})
  const firstAvailable = options.find((o) => o.available !== 0) ?? options[0]
  const [chosen, setChosen] = useState(firstAvailable.name)
  const option = options.find((o) => o.name === chosen) ?? firstAvailable
  const soldOut = option.available === 0
  const limit = Math.min(maxQuantity, option.available ?? maxQuantity)

  return (
    <form action={action} className="space-y-5" data-testid="add-to-cart">
      <input type="hidden" name="productId" value={productId} />
      {options.length > 1 ? (
        <fieldset>
          <legend className="block text-sm font-semibold text-ink">Glaze</legend>
          <div className="mt-2 grid gap-2">
            {options.map((o) => (
              <label
                key={o.name}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border-2 border-line bg-white/80 px-4 py-2.5 has-checked:border-clay has-disabled:cursor-not-allowed has-disabled:opacity-60"
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="variant"
                    value={o.name}
                    checked={o.name === chosen}
                    onChange={() => setChosen(o.name)}
                    disabled={o.available === 0}
                    className="size-4 accent-clay"
                  />
                  <span className="font-semibold text-ink">{o.name}</span>
                  {o.stockLabel && <span className="text-sm text-ink-soft">{o.stockLabel}</span>}
                </span>
                <span className="font-display text-lg text-ink">{o.priceLabel}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="variant" value={option.name} />
      )}
      {!soldOut && (
        <SelectField id="quantity" label="Quantity" defaultValue="1" key={chosen}>
          {Array.from({ length: limit }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectField>
      )}
      {state.error && (
        <Alert tone="danger" title="We couldn’t add that">
          {state.error}
        </Alert>
      )}
      {state.added && !state.error && (
        <Alert tone="success" title="Added to your cart">
          <Link href="/shop/cart" className="font-semibold underline underline-offset-4">
            View cart
          </Link>
        </Alert>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending || soldOut}>
        {soldOut ? 'Sold out' : pending ? 'Adding…' : `Add to cart · ${option.priceLabel}`}
      </Button>
    </form>
  )
}
