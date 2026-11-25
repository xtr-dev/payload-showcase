import { notificationsPlugin, type WebPushConfig } from '@xtr-dev/payload-notifications'
import type { Access, CollectionAfterChangeHook, CollectionConfig, Payload, Plugin } from 'payload'

import { getUser, isAdmin, isAdminField, isAdminUser, isLoggedIn } from '@/access'
import {
  CHANNELS,
  OPTIONAL_CHANNEL_IDS,
  messageText,
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
 * Subscription channels are kept in sync with the member's preferences by the users hook below.
 */
const findSubscriptions = async (notification: Record<string, unknown>, payload: Payload) => {
  const recipient = relId(notification.recipient)
  const channel = typeof notification.channel === 'string' ? notification.channel : null
  const { docs } = await payload.find({
    collection: 'push-subscriptions',
    where: {
      and: [
        { isActive: { equals: true } },
        recipient !== null
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
    // The plugin's default links to the admin panel and only reads Slate-style rich text, so
    // members get a plain-text excerpt and a link to their own inbox instead.
    transformNotification: (doc: { id: number; title: string; message: unknown }) => {
      const body = messageText(doc.message)
      return {
        title: doc.title,
        body: body.length > 120 ? `${body.slice(0, 117)}…` : body || 'You have a new notification',
        tag: `notification-${doc.id}`,
        // The plugin's service worker reads `id` and `trackClose` when it reports a closed
        // notification to the /api/push-notifications/track endpoint.
        data: {
          url: '/account#notifications',
          notificationId: doc.id,
          id: doc.id,
          trackClose: true,
        },
      }
    },
  }
}

/**
 * Members read their own notifications and broadcasts; only admins write notification content.
 * The plugin's defaults let any signed-in user read every notification and create new ones, and
 * let members flip `isRead` on broadcasts, which is shared by everyone. Members may update only
 * their own personal notifications (and, via the plugin's field access, only isRead/readAt).
 */
const ownOrBroadcast: Access = ({ req }) => {
  const user = getUser(req)
  if (!user) return false
  if (isAdminUser(user)) return true
  return { or: [{ recipient: { equals: user.id } }, { recipient: { exists: false } }] }
}

const ownPersonal: Access = ({ req }) => {
  const user = getUser(req)
  if (!user) return false
  if (isAdminUser(user)) return true
  return { recipient: { equals: user.id } }
}

const ownOrAdmin: Access = ({ req }) => {
  const user = getUser(req)
  if (!user) return false
  if (isAdminUser(user)) return true
  return { user: { equals: user.id } }
}

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
    defaultColumns: ['title', 'channel', 'recipient', 'isRead', 'createdAt'],
    description:
      'Leave Recipient empty to broadcast to every member who follows the channel. Read state of broadcasts is tracked per member under Notification reads.',
  },
  access: {
    ...config.access,
    read: ownOrBroadcast,
    create: isAdmin,
    update: ownPersonal,
    delete: isAdmin,
  },
  hooks: {
    ...config.hooks,
    afterDelete: [
      ...(config.hooks?.afterDelete ?? []),
      async ({ id, req }) => {
        await req.payload.delete({
          collection: 'notification-reads',
          where: { notification: { equals: id } },
          req,
        })
      },
    ],
  },
})

/** Per-member read receipts for broadcasts. */
const NotificationReads: CollectionConfig = {
  slug: 'notification-reads',
  labels: { singular: 'Notification read', plural: 'Notification reads' },
  admin: {
    group: 'Notifications',
    useAsTitle: 'key',
    defaultColumns: ['user', 'notification', 'createdAt'],
    description:
      'Which member has read which broadcast. Personal notifications use their own Read flag.',
  },
  access: {
    read: ownOrAdmin,
    create: isLoggedIn,
    update: isAdmin,
    delete: ownOrAdmin,
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    {
      name: 'notification',
      type: 'relationship',
      relationTo: 'notifications',
      required: true,
    },
    {
      // `user:notification`, so a member can't record the same read twice.
      name: 'key',
      type: 'text',
      unique: true,
      admin: { readOnly: true },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, req }) => {
        const user = getUser(req)
        if (user && !isAdminUser(user)) {
          data.user = user.id
          const notification = await req.payload.findByID({
            collection: 'notifications',
            id: relId(data.notification) ?? 0,
            depth: 0,
            req,
          })
          if (relId(notification.recipient) !== null) {
            throw new Error('Read receipts are only for broadcasts.')
          }
        }
        data.key = `${relId(data.user)}:${relId(data.notification)}`
        return data
      },
    ],
  },
}

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

const addReadsCollection: Plugin = (config) => ({
  ...config,
  collections: [...(config.collections ?? []), NotificationReads],
})

/**
 * Users get a `notificationChannels` preference. Their push subscriptions follow it, and their
 * notifications, receipts and devices are removed with them: the plugin stores broadcasts as
 * notifications without a recipient, so a deleted member's notifications would otherwise turn
 * into broadcasts for everyone.
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
    beforeDelete: [
      ...(users.hooks?.beforeDelete ?? []),
      async ({ id, req }) => {
        for (const [collection, field] of [
          ['notifications', 'recipient'],
          ['notification-reads', 'user'],
          ['push-subscriptions', 'user'],
        ] as const) {
          await req.payload.delete({ collection, where: { [field]: { equals: id } }, req })
        }
      },
    ],
  },
}))

export const notifications: Plugin[] = [
  notificationsPlugin({
    channels: CHANNELS.map(({ id, name, description }) => ({ id, name, description })),
    webPush: webPush(),
    collectionOverrides: {
      notifications: notificationsCollection,
      pushSubscriptions: (config) => ({
        ...config,
        admin: { ...config.admin, group: 'Notifications' },
      }),
    },
  }),
  addReadsCollection,
  extendUsers,
  extendBookings,
]
