'use client'

import { useActionState } from 'react'

import { Alert, Button, TextAreaField } from '@/components/ui'

import { reserveSeat, type BookingFormState } from './actions'

export interface BookingFlowProps {
  sessionId: number
  priceLabel: string
}

/** The classic one-step booking form: optional notes, then reserve and continue to payment. */
export const BookingForm = ({ sessionId, priceLabel }: BookingFlowProps) => {
  const [state, action, pending] = useActionState<BookingFormState, FormData>(reserveSeat, {})
  return (
    <form action={action} className="space-y-5" data-booking-flow="classic">
      <input type="hidden" name="sessionId" value={sessionId} />
      <TextAreaField
        id="notes"
        label="Anything we should know? (optional)"
        hint="Allergies, accessibility needs, or if you are left-handed at the wheel."
        maxLength={1000}
      />
      {state.error && (
        <Alert tone="danger" title="We couldn’t reserve your seat">
          {state.error}
        </Alert>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Reserving…' : `Reserve seat · ${priceLabel}`}
      </Button>
      <p className="text-center text-sm text-ink-soft">
        Your seat is held while you complete payment.
      </p>
    </form>
  )
}
