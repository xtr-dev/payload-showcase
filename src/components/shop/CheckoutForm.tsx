'use client'

import { useActionState } from 'react'

import { Alert, Button, SelectField, TextField } from '@/components/ui'

import { placeOrderAction, type CheckoutFormState } from './actions'

/**
 * Delivery details and the button that places the order. A signed-in member is not asked for an
 * email; a guest has to give one. The coupon code travels as a hidden field and is validated
 * again on the server, together with everything else.
 */
export const CheckoutForm = ({
  guest,
  couponCode,
  totalLabel,
  countries,
  defaults,
}: {
  guest: boolean
  couponCode?: string
  totalLabel: string
  countries: ReadonlyArray<{ code: string; name: string }>
  /** Prefills the name for a signed-in member. */
  defaults: { firstName?: string; lastName?: string }
}) => {
  const [state, action, pending] = useActionState<CheckoutFormState, FormData>(placeOrderAction, {})
  const value = { ...defaults, ...state.values }
  const errors = state.fieldErrors ?? {}
  return (
    <form action={action} className="space-y-5" noValidate data-testid="checkout-form">
      {couponCode && <input type="hidden" name="couponCode" value={couponCode} />}
      {guest && (
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          hint="For your order confirmation."
          defaultValue={value.email}
          error={errors.email}
          maxLength={254}
          required
        />
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id="firstName"
          label="First name"
          autoComplete="given-name"
          defaultValue={value.firstName}
          error={errors.firstName}
          maxLength={80}
          required
        />
        <TextField
          id="lastName"
          label="Last name"
          autoComplete="family-name"
          defaultValue={value.lastName}
          error={errors.lastName}
          maxLength={80}
          required
        />
      </div>
      <TextField
        id="address1"
        label="Street and house number"
        autoComplete="address-line1"
        defaultValue={value.address1}
        error={errors.address1}
        maxLength={120}
        required
      />
      <TextField
        id="address2"
        label="Apartment, floor (optional)"
        autoComplete="address-line2"
        defaultValue={value.address2}
        error={errors.address2}
        maxLength={120}
      />
      <div className="grid gap-5 sm:grid-cols-[1fr_2fr]">
        <TextField
          id="postalCode"
          label="Postcode"
          autoComplete="postal-code"
          defaultValue={value.postalCode}
          error={errors.postalCode}
          maxLength={12}
          required
        />
        <TextField
          id="city"
          label="Town or city"
          autoComplete="address-level2"
          defaultValue={value.city}
          error={errors.city}
          maxLength={80}
          required
        />
      </div>
      <SelectField
        id="country"
        label="Country"
        autoComplete="country"
        defaultValue={value.country ?? countries[0].code}
        // Remount with the submitted value: React resets uncontrolled fields after an action.
        key={value.country}
        hint="We ship within the Netherlands, Belgium and Germany."
      >
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </SelectField>
      {state.error && (
        <Alert tone="danger" title="We couldn’t place your order">
          {state.error}
        </Alert>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Placing your order…' : `Pay ${totalLabel}`}
      </Button>
      <p className="text-center text-sm text-ink-soft">
        Your items are held while you pay. Nothing is charged on this demo.
      </p>
    </form>
  )
}
