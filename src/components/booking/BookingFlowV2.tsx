'use client'

import { useActionState, useState } from 'react'

import { Alert, Badge, Button, TextAreaField } from '@/components/ui'

import { reserveSeat, type BookingFormState } from './actions'
import type { BookingFlowProps } from './BookingForm'

const EXPERIENCE = [
  { value: 'first-time', label: 'First time at the wheel' },
  { value: 'some', label: 'I have done a class or two' },
  { value: 'regular', label: 'I throw regularly' },
] as const

type Experience = (typeof EXPERIENCE)[number]['value']

/**
 * The new booking flow, rolled out behind the `new-booking-flow` feature flag
 * (see src/lib/flags.ts and src/app/(frontend)/book/[sessionId]/page.tsx).
 *
 * Compared with the classic form it asks for the member's experience level (so the teacher can
 * plan the evening) and shows a live summary of what they are about to reserve. The experience is
 * prepended to the booking notes. It submits through the same `reserveSeat` action, and keeps the
 * same "Reserve seat" button, so both flows behave the same for the rest of the site.
 */
export const BookingFlowV2 = ({ sessionId, priceLabel }: BookingFlowProps) => {
  const [state, action, pending] = useActionState<BookingFormState, FormData>(reserveSeat, {})
  const [experience, setExperience] = useState<Experience>('first-time')
  const [notes, setNotes] = useState('')
  const experienceLabel = EXPERIENCE.find((e) => e.value === experience)!.label
  const combinedNotes = `Experience: ${experienceLabel}.${notes.trim() ? `\n${notes.trim()}` : ''}`

  return (
    <form action={action} className="space-y-5" data-booking-flow="v2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="notes" value={combinedNotes} />
      <Badge tone="glaze">New booking flow</Badge>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-ink">
          How much have you worked with clay?
        </legend>
        {EXPERIENCE.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-line bg-white/80 px-4 py-3 has-checked:border-glaze"
          >
            <input
              type="radio"
              name="experience"
              value={option.value}
              checked={experience === option.value}
              onChange={() => setExperience(option.value)}
              className="accent-glaze"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <TextAreaField
        id="booking-notes"
        name="booking-notes"
        label="Anything we should know? (optional)"
        hint="Allergies, accessibility needs, or if you are left-handed at the wheel."
        maxLength={900}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div
        className="rounded-card border border-line bg-white/70 p-5 text-sm"
        aria-live="polite"
        data-testid="booking-summary"
      >
        <p className="font-semibold text-ink">Your teacher will see</p>
        <p className="mt-1 whitespace-pre-line text-ink-soft">{combinedNotes}</p>
        <p className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-ink-soft">To pay after reserving</span>
          <span className="font-display text-xl font-semibold text-clay">{priceLabel}</span>
        </p>
      </div>

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
