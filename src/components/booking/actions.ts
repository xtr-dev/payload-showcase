'use server'

import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth'
import { beginBookingCheckout } from '@/lib/checkout'
import { getPayloadClient } from '@/lib/payload'

export interface BookingFormState {
  error?: string
}

/**
 * Creates a pending booking for the signed-in member and hands over to checkout.
 * Shared by the classic booking form and BookingFlowV2.
 */
export async function reserveSeat(
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const sessionId = Number(formData.get('sessionId'))
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/book/${sessionId}`)}`)

  const payload = await getPayloadClient()
  let redirectTo: string
  try {
    // Runs with the member's own access rights, so the Bookings hooks set the member, price and
    // status, and enforce seat limits, exactly as they would for a REST request.
    const booking = await payload.create({
      collection: 'bookings',
      data: {
        session: sessionId,
        member: user.id,
        // Ignored for members (field access); the hooks always start a booking as pending.
        status: 'pending',
        notes: String(formData.get('notes') ?? '').slice(0, 1000) || undefined,
      },
      user,
      overrideAccess: false,
    })
    ;({ redirectTo } = await beginBookingCheckout({ payload, booking, user }))
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
    }
  }
  redirect(redirectTo)
}
