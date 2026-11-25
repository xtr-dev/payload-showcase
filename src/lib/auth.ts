import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import type { User } from '@/payload-types'

import { getPayloadClient } from './payload'

/** The signed-in site user for this request (from the `payload-token` cookie), or null. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const payload = await getPayloadClient()
  const { user } = await payload.auth({ headers: await headers() })
  return user && user.collection === 'users' ? (user as User) : null
})

/** Like getCurrentUser, but sends visitors to the login page and back to `returnTo` afterwards. */
export const requireUser = async (returnTo: string): Promise<User> => {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`)
  return user
}

/** Only allows same-site relative paths as post-login redirect targets. */
export const safeNext = (next: string | string[] | undefined, fallback = '/account'): string => {
  const value = Array.isArray(next) ? next[0] : next
  return value && value.startsWith('/') && !value.startsWith('//') ? value : fallback
}
