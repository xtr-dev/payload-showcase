import type { Payload } from 'payload'

import type { Booking, MembershipPlan, User } from '@/payload-types'

/**
 * Checkout entry points used by the booking and membership pages.
 *
 * Phase 2 (billing) owns this file: it replaces these stubs with @xtr-dev/payload-billing so that
 * a payment is created and the visitor is sent to the provider (the local test provider by
 * default). Keep the signatures stable; the pages only rely on `redirectTo`.
 */

export interface CheckoutResult {
  /** Where to send the visitor next: a payment page, or a confirmation page. */
  redirectTo: string
}

/** Called right after a pending booking is created for the signed-in member. */
export const beginBookingCheckout = async (args: {
  payload: Payload
  booking: Booking
  user: User
}): Promise<CheckoutResult> => ({
  redirectTo: `/account?booked=${encodeURIComponent(args.booking.reference ?? '')}`,
})

/** Called when a signed-in member chooses a membership plan. */
export const beginMembershipCheckout = async ({
  payload,
  plan,
  user,
}: {
  payload: Payload
  plan: MembershipPlan
  user: User
}): Promise<CheckoutResult> => {
  // Without billing, record the choice as pending; billing activates it once payment succeeds.
  await payload.update({
    collection: 'users',
    id: user.id,
    data: { membershipPlan: plan.id, membershipStatus: 'pending' },
    overrideAccess: true,
  })
  return { redirectTo: '/account?membership=pending' }
}
