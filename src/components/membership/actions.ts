'use server'

import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth'
import { beginMembershipCheckout } from '@/lib/checkout'
import { getPayloadClient } from '@/lib/payload'

/** Starts checkout for the chosen membership plan (see src/lib/checkout.ts). */
export async function joinMembership(formData: FormData): Promise<void> {
  const slug = String(formData.get('plan') ?? '')
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/membership/join/${slug}`)}`)

  const payload = await getPayloadClient()
  const { docs } = await payload.find({
    collection: 'membership-plans',
    where: { slug: { equals: slug } },
    limit: 1,
  })
  if (!docs[0]) redirect('/membership')
  const { redirectTo } = await beginMembershipCheckout({ payload, plan: docs[0], user })
  redirect(redirectTo)
}
