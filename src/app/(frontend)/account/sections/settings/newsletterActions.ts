'use server'

import { revalidatePath } from 'next/cache'

import { getCurrentUser } from '@/lib/auth'
import { setNewsletterSubscription } from '@/lib/mailing'
import { getPayloadClient } from '@/lib/payload'

export interface NewsletterState {
  error?: string
  message?: string
}

/**
 * Opts the signed-in member in to or out of the newsletter. The users hook in
 * src/plugins/mailing.ts then sends the confirmation, or withdraws scheduled issues.
 */
export async function updateNewsletter(
  _prev: NewsletterState,
  formData: FormData,
): Promise<NewsletterState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in again.' }
  const subscribe = formData.get('subscribe') === 'true'
  try {
    const payload = await getPayloadClient()
    await setNewsletterSubscription(payload, user, subscribe)
  } catch {
    return { error: 'We couldn’t update your newsletter setting. Please try again.' }
  }
  revalidatePath('/account')
  return {
    message: subscribe
      ? 'Subscribed. We sent you a confirmation email.'
      : 'Unsubscribed. You won’t get the next issue.',
  }
}
