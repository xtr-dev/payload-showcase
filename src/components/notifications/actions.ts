'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth'
import { markAllRead, markRead, notifyMember, OPTIONAL_CHANNEL_IDS } from '@/lib/notifications'
import { getPayloadClient } from '@/lib/payload'
import type { User } from '@/payload-types'

const signedIn = async (): Promise<User> => {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=%2Faccount%23notifications')
  return user
}

/** Re-renders every page, so the header bell's unread count updates along with the inbox. */
const refresh = () => revalidatePath('/', 'layout')

/** Marks one notification in the signed-in member's inbox as read. */
export async function markNotificationRead(formData: FormData): Promise<void> {
  const user = await signedIn()
  const id = Number(formData.get('id'))
  if (Number.isInteger(id)) await markRead(await getPayloadClient(), user, id)
  refresh()
}

/** Marks the whole inbox as read. */
export async function markAllNotificationsRead(): Promise<void> {
  const user = await signedIn()
  await markAllRead(await getPayloadClient(), user)
  refresh()
}

/** Saves which broadcast channels the member follows (checkboxes named `channel`). */
export async function saveNotificationChannels(formData: FormData): Promise<void> {
  const user = await signedIn()
  const picked = formData.getAll('channel').map(String)
  const channels = OPTIONAL_CHANNEL_IDS.filter((id) => picked.includes(id))
  const payload = await getPayloadClient()
  // Runs with the member's own access rights: members may update only their own user document.
  await payload.update({
    collection: 'users',
    id: user.id,
    data: { notificationChannels: channels },
    user,
    overrideAccess: false,
  })
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
