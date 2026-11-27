import { notificationsPlugin, type WebPushConfig } from '@xtr-dev/payload-notifications'
import type { CollectionAfterChangeHook, CollectionConfig, Payload, Plugin } from 'payload'

import { CHANNELS, notifyBookingStatus, vapidKeys } from '@/lib/notifications'
import type { Booking, ChannelSubscription } from '@/payload-types'

import { extendCollection } from './utils'

/**
 * @xtr-dev/payload-notifications
 *
 * In-app inbox for members (booking confirmations, class reminders, studio news channels),
 * per-member channel opt-outs (the plugin's `channel-subscriptions` collection) and optional web
 * push. See src/lib/notifications.ts for the helpers the site and other plugins use.
 *
 * Env: NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (+ VAPID_SUBJECT) turn on web push. Without
 * them the inbox works as usual and the plugin registers no push endpoints.
 */

const relId = (value: unknown): number | null => {
  if (value == null) return null
  if (typeof value === 'object' && 'id' in value) return Number((value as { id: unknown }).id)
  return Number(value)
}

/**
 * Picks the devices a notification is pushed to. Personal notifications go to all of the
 * recipient's devices, whatever the channel, like the inbox. Broadcasts go to devices subscribed
 * to the notification's channel, except those of members who opted out of that channel: a custom
 * `findSubscriptions` replaces the plugin's own targeting, so it has to apply the members'
 * channel subscriptions itself. A personal notification whose recipient was deleted goes nowhere.
 */
const findSubscriptions = async (notification: Record<string, unknown>, payload: Payload) => {
  const recipient = relId(notification.recipient)
  const channel = typeof notification.channel === 'string' ? notification.channel : null
  if (notification.audience !== 'broadcast' && recipient === null) return []
  const optedOut =
    notification.audience === 'broadcast' && channel ? await optedOutOf(payload, channel) : []
  const { docs } = await payload.find({
    collection: 'push-subscriptions',
    where: {
      and: [
        { isActive: { equals: true } },
        notification.audience !== 'broadcast'
          ? { user: { equals: recipient } }
          : channel
            ? { channels: { in: [channel] } }
            : { id: { exists: true } },
        ...(optedOut.length ? [{ user: { not_in: optedOut } }] : []),
      ],
    },
    depth: 0,
    pagination: false,
  })
  return docs
}

/** Ids of the members who opted out of `channel` (a `subscribed: false` channel subscription). */
const optedOutOf = async (payload: Payload, channel: string): Promise<number[]> => {
  const { docs } = await payload.find({
    collection: 'channel-subscriptions',
    where: {
      and: [
        { channel: { equals: channel as ChannelSubscription['channel'] } },
        { subscribed: { equals: false } },
      ],
    },
    depth: 0,
    pagination: false,
  })
  return docs.map((doc) => relId(doc.user)).filter((id): id is number => id !== null)
}

const webPush = (): WebPushConfig | undefined => {
  const keys = vapidKeys()
  if (!keys) return undefined
  return {
    enabled: true,
    autoPush: true,
    vapidPublicKey: keys.publicKey,
    vapidPrivateKey: keys.privateKey,
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:hello@kiln.test',
    findSubscriptions,
    // The plugin's default transformer sends the title and a plain-text excerpt of the message;
    // a click opens the member's inbox.
    notificationUrl: '/account#notifications',
  }
}

/**
 * Adds the booking link and event to notifications and groups the plugin's collections in the
 * admin. Access stays the plugin's default: members read their own notifications and broadcasts,
 * only admins write content, and broadcast read state is kept per member in `notification-reads`.
 * The two added fields need no update rule of their own: the plugin lets a recipient change
 * nothing but the read state of their notification unless a field is listed in its
 * `recipientEditableFields` option, which the site leaves empty.
 */
const notificationsCollection = (config: CollectionConfig): CollectionConfig => ({
  ...config,
  fields: [
    ...config.fields,
    {
      name: 'booking',
      type: 'relationship',
      relationTo: 'bookings',
      index: true,
      admin: { position: 'sidebar', description: 'The booking this notification is about.' },
    },
    {
      // Set by notifyBookingStatus so each booking event is announced at most once.
      name: 'event',
      type: 'select',
      options: [
        { label: 'Booking confirmed', value: 'booking-confirmed' },
        { label: 'Booking refunded', value: 'booking-refunded' },
      ],
      admin: { position: 'sidebar', readOnly: true },
    },
  ],
  admin: {
    ...config.admin,
    group: 'Notifications',
    defaultColumns: ['title', 'channel', 'audience', 'recipient', 'createdAt'],
    description:
      'Leave Recipient empty to broadcast to every member who follows the channel. Read state of broadcasts is tracked per member under Notification reads.',
  },
})

/** Set `context: { skipNotifications: true }` on a booking write to send no notification. */
const SKIP_NOTIFICATIONS = 'skipNotifications'

/**
 * Notifies the member when a booking becomes `paid` (confirmed) or `refunded`, mirroring mailing's
 * confirmation email: only on a status transition, and at most once per booking and event. Runs in
 * the booking write's transaction; a failure is logged and never blocks the booking.
 */
const bookingNotifications: CollectionAfterChangeHook<Booking> = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (req.context?.[SKIP_NOTIFICATIONS]) return doc
  const before = operation === 'create' ? undefined : previousDoc?.status
  if (before === doc.status) return doc
  try {
    await notifyBookingStatus(req.payload, doc, { req })
  } catch (error) {
    req.payload.logger.error({
      err: error,
      msg: `Booking notification for ${doc.reference} failed`,
    })
  }
  return doc
}

const extendBookings = extendCollection('bookings', (bookings) => ({
  ...bookings,
  hooks: {
    ...bookings.hooks,
    afterChange: [...(bookings.hooks?.afterChange ?? []), bookingNotifications],
  },
}))

const inGroup = (config: CollectionConfig): CollectionConfig => ({
  ...config,
  admin: { ...config.admin, group: 'Notifications' },
})

export const notifications: Plugin[] = [
  notificationsPlugin({
    channels: CHANNELS.map(({ id, name, description }) => ({ id, name, description })),
    webPush: webPush(),
    collectionOverrides: {
      notifications: notificationsCollection,
      pushSubscriptions: inGroup,
      notificationReads: inGroup,
      channelSubscriptions: inGroup,
    },
  }),
  extendBookings,
]
