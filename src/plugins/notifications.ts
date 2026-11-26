import { notificationsPlugin, type WebPushConfig } from '@xtr-dev/payload-notifications'
import type { CollectionAfterChangeHook, CollectionConfig, Payload, Plugin } from 'payload'

import { isAdminField } from '@/access'
import {
  CHANNELS,
  OPTIONAL_CHANNEL_IDS,
  notifyBookingStatus,
  pushChannelsFor,
  vapidKeys,
} from '@/lib/notifications'
import type { Booking, User } from '@/payload-types'

import { extendCollection } from './utils'

/**
 * @xtr-dev/payload-notifications
 *
 * In-app inbox for members (booking confirmations, class reminders, studio news channels) and
 * optional web push. See src/lib/notifications.ts for the helpers the site and other plugins use.
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
 * recipient's devices; broadcasts go to devices whose channels include the notification's channel.
 * A personal notification whose recipient was deleted goes nowhere. Subscription channels are kept
 * in sync with the member's preferences by the users hook below.
 */
const findSubscriptions = async (notification: Record<string, unknown>, payload: Payload) => {
  const recipient = relId(notification.recipient)
  const channel = typeof notification.channel === 'string' ? notification.channel : null
  if (notification.audience !== 'broadcast' && recipient === null) return []
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
      ],
    },
    depth: 0,
    pagination: false,
  })
  return docs
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
      access: { update: isAdminField },
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
      access: { update: isAdminField },
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

/**
 * Users get a `notificationChannels` preference, and their push subscriptions follow it. (The
 * plugin itself removes a deleted member's notifications, read receipts and devices.)
 */
const extendUsers = extendCollection('users', (users) => ({
  ...users,
  fields: [
    ...users.fields,
    {
      name: 'notificationChannels',
      type: 'select',
      hasMany: true,
      label: 'Notification channels',
      options: CHANNELS.filter((c) => c.optional).map((c) => ({ label: c.name, value: c.id })),
      defaultValue: OPTIONAL_CHANNEL_IDS,
      admin: {
        description: 'Broadcast channels this member follows. Bookings are always delivered.',
      },
    },
  ],
  hooks: {
    ...users.hooks,
    afterChange: [
      ...(users.hooks?.afterChange ?? []),
      async ({ doc, previousDoc, operation, req }) => {
        if (operation !== 'update') return doc
        const before = JSON.stringify(previousDoc?.notificationChannels ?? null)
        if (before === JSON.stringify(doc.notificationChannels ?? null)) return doc
        await req.payload.update({
          collection: 'push-subscriptions',
          where: { user: { equals: doc.id } },
          data: { channels: pushChannelsFor(doc as User) as never },
          req,
        })
        return doc
      },
    ],
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
    },
  }),
  extendUsers,
  extendBookings,
]
