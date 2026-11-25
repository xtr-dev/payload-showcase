'use server'

import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth'
import { beginBookingCheckout } from '@/lib/checkout'
import { getPayloadClient } from '@/lib/payload'

/**
 * Starts a new payment for one of the member's own bookings that is still waiting for payment
 * (after a declined or cancelled attempt). The booking keeps its seat and its open invoice.
 */
export async function retryBookingPayment(formData: FormData): Promise<void> {
  const bookingId = Number(formData.get('bookingId'))
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=%2Faccount')

  const payload = await getPayloadClient()
  // Read with the member's own access, so nobody can pay into someone else's booking.
  const booking = await payload
    .findByID({ collection: 'bookings', id: bookingId, depth: 0, user, overrideAccess: false })
    .catch(() => null)
  if (!booking || booking.status !== 'pending') redirect('/account')

  const { redirectTo } = await beginBookingCheckout({ payload, booking, user })
  redirect(redirectTo)
}
