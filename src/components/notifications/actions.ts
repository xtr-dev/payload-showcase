'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth'
import { notifyMember, setFollowedChannels } from '@/lib/notifications'
import { getPayloadClient } from '@/lib/payload'
import type { User } from '@/payload-types'

const signedIn = async (): Promise<User> => {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=%2Faccount%23notifications')
  return user
}

/** Re-renders every page, so the header bell's unread count updates along with the inbox. */
const refresh = () => revalidatePath('/', 'layout')

/** Saves which broadcast channels the member follows (checkboxes named `channel`). */
export async function saveNotificationChannels(formData: FormData): Promise<void> {
  const user = await signedIn()
  // Always written for the signed-in member: the plugin keeps one channel-subscription row per
  // member and channel, and an unticked channel is stored as an opt-out.
  await setFollowedChannels(await getPayloadClient(), user, formData.getAll('channel').map(String))
  refresh()
}

/**
 * Sends the member a personal test notification. With web push configured, the plugin's autoPush
 * hook also delivers it to every device they subscribed.
 */
export async function sendTestNotification(): Promise<void> {
  const user = await signedIn()
  await notifyMember(await getPayloadClient(), user.id, {
    title: 'Test notification',
    channel: 'bookings',
    message: 'Push works on this device. This notification is also in your inbox.',
  })
  refresh()
}
