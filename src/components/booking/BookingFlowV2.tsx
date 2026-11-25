'use client'

import { BookingForm, type BookingFlowProps } from './BookingForm'

/**
 * The new booking flow, rolled out behind the `new-booking-flow` feature flag
 * (see src/lib/flags.ts and src/app/(frontend)/book/[sessionId]/page.tsx).
 *
 * Phase 2 (feature-flags) owns this file and builds the new flow here. Until then it renders the
 * classic form, so turning the flag on is harmless.
 */
export const BookingFlowV2 = (props: BookingFlowProps) => <BookingForm {...props} />
