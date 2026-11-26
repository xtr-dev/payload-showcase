import type { Payload, PayloadRequest, Where } from 'payload'

import type { Booking, Notification, User } from '@/payload-types'

import { formatDate, formatPrice, formatTime } from './format'

import { richText, type RichTextValue } from './richtext'

/**
 * Server-side helpers for the member inbox (@xtr-dev/payload-notifications).
 *
 * The plugin stores a personal message with `audience: 'user'` and a `recipient`, and a broadcast
 * with `audience: 'broadcast'` and no recipient. When a member reads notifications with their own
 * access rights, the plugin fills in `isRead`/`readAt` of each broadcast from that member's read
 * receipts, so `isRead` is always "has this member read it". Members mark notifications read or
 * unread through the plugin's `POST`/`DELETE /api/notifications/:id/read` endpoint (see
 * src/components/notifications/ReadButtons.tsx).
 */

/** Channel ids, shared by the plugin config, the users field and the UI. */
export type ChannelId = 'bookings' | 'studio-news' | 'class-reminders'

export interface ChannelDefinition {
  id: ChannelId
  name: string
  description: string
  /** Optional channels can be switched off by members; they only filter broadcasts. */
  optional: boolean
}

export const CHANNELS: ChannelDefinition[] = [
  {
    id: 'bookings',
    name: 'Bookings',
    description: 'Confirmations and changes to your own bookings. Always on.',
    optional: false,
  },
  {
    id: 'class-reminders',
    name: 'Class reminders',
    description: 'Reminders before your classes and studio-wide class updates.',
    optional: true,
  },
  {
    id: 'studio-news',
    name: 'Studio news',
    description: 'Kiln firing schedules, open-studio hours and events.',
    optional: true,
  },
]

/** The channels members can switch off, typed like the `users.notificationChannels` field. */
export const OPTIONAL_CHANNEL_IDS = CHANNELS.filter((c) => c.optional).map(
  (c) => c.id,
) as NonNullable<User['notificationChannels']>

export const channelName = (id: string | null | undefined): string =>
  CHANNELS.find((c) => c.id === id)?.name ?? 'General'

/** The broadcast channels a member follows. Unset (older accounts) means all of them. */
export const followedChannels = (user: Pick<User, 'notificationChannels'>): ChannelId[] =>
  (user.notificationChannels ?? OPTIONAL_CHANNEL_IDS) as ChannelId[]

/** Channels a member's push subscriptions receive: the always-on ones plus those they follow. */
export const pushChannelsFor = (user: Pick<User, 'notificationChannels'>): ChannelId[] => [
  ...CHANNELS.filter((c) => !c.optional).map((c) => c.id),
  ...followedChannels(user),
]

/** VAPID keys for web push, or null when push isn't configured (the default). */
export const vapidKeys = (): { publicKey: string; privateKey: string } | null => {
  // Read by computed name: Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, and the keys
  // must be picked up at runtime so a built app can turn push on by setting them.
  const env = (name: string) => process.env[name]?.trim()
  const publicKey = env('NEXT_PUBLIC_VAPID_PUBLIC_KEY')
  const privateKey = env('VAPID_PRIVATE_KEY')
  return publicKey && privateKey ? { publicKey, privateKey } : null
}

type MessageInput = string | RichTextValue

const toRichText = (message: MessageInput): RichTextValue =>
  typeof message === 'string' ? richText(...message.split(/\n{2,}/)) : message

export interface NotifyOptions {
  title: string
  /** Plain text (blank lines start a new paragraph) or Lexical rich text. */
  message: MessageInput
  channel?: ChannelId
  /** Pass the hook's `req` when calling from inside a Payload hook, to share its transaction. */
  req?: PayloadRequest
  /** The booking this notification is about, if any. */
  booking?: number
  /** What happened, for notifications that must be sent at most once (see notifyBookingStatus). */
  event?: NonNullable<Notification['event']>
}

/**
 * Sends a personal notification to one member, e.g. "Your booking is confirmed". It shows up in
 * their inbox and header bell and, when web push is configured, on their subscribed devices.
 *
 * Runs with the Local API's default `overrideAccess`, because members can't create notifications.
 */
export const notifyMember = (
  payload: Payload,
  userId: number | string,
  { title, message, channel = 'bookings', req, booking, event }: NotifyOptions,
): Promise<Notification> =>
  payload.create({
    collection: 'notifications',
    data: {
      title,
      message: toRichText(message),
      channel,
      recipient: Number(userId),
      audience: 'user',
      booking,
      event,
    },
    req,
  })

const relIdOf = (value: unknown): number | null =>
  value == null
    ? null
    : typeof value === 'object' && 'id' in value
      ? Number((value as { id: unknown }).id)
      : Number(value)

/**
 * Tells the member their booking was confirmed (status `paid`) or refunded (status `refunded`), on
 * the Bookings channel. Each event is sent at most once per booking, like mailing's confirmation
 * email: a booking that is paid again later, or a hook that runs twice, doesn't send a duplicate.
 * Returns the notification, or null when nothing was sent. Other statuses send nothing.
 */
export const notifyBookingStatus = async (
  payload: Payload,
  booking: Booking,
  { req }: { req?: PayloadRequest } = {},
): Promise<Notification | null> => {
  const event =
    booking.status === 'paid'
      ? 'booking-confirmed'
      : booking.status === 'refunded'
        ? 'booking-refunded'
        : null
  const memberId = relIdOf(booking.member)
  if (!event || memberId === null) return null

  const { totalDocs } = await payload.count({
    collection: 'notifications',
    where: { and: [{ booking: { equals: booking.id } }, { event: { equals: event } }] },
    req,
  })
  if (totalDocs > 0) return null

  const session = await payload.findByID({
    collection: 'sessions',
    id: relIdOf(booking.session) ?? 0,
    depth: 1,
    req,
  })
  const workshop = typeof session.workshop === 'object' ? session.workshop : null
  const what = workshop?.title ?? 'your workshop'
  const when = `${formatDate(session.startsAt)} at ${formatTime(session.startsAt)}`

  return notifyMember(payload, memberId, {
    channel: 'bookings',
    booking: booking.id,
    event,
    req,
    ...(event === 'booking-confirmed'
      ? {
          title: 'Booking confirmed',
          message: `See you at ${what} on ${when}. Your booking reference is ${booking.reference}.`,
        }
      : {
          title: 'Booking refunded',
          message: `Booking ${booking.reference} for ${what} on ${when} was refunded. ${formatPrice(booking.amount, booking.currency ?? 'EUR')} is on its way back to you, and your seat is free for someone else.`,
        }),
  })
}

/**
 * Sends a broadcast to every member who follows `channel`, e.g. "Kiln firing schedule changed".
 * Broadcasts have no recipient; the plugin keeps each member's read state in `notification-reads`.
 */
export const broadcast = (
  payload: Payload,
  { title, message, channel = 'studio-news', req }: NotifyOptions,
): Promise<Notification> =>
  payload.create({
    collection: 'notifications',
    data: { title, message: toRichText(message), channel, audience: 'broadcast' },
    req,
  })

/** Query for the notifications in a member's inbox: their own plus broadcasts they follow. */
export const inboxWhere = (user: User): Where => {
  const channels = followedChannels(user)
  return {
    or: [
      { recipient: { equals: user.id } },
      {
        and: [
          { audience: { equals: 'broadcast' } },
          {
            or: [
              { channel: { exists: false } },
              ...(channels.length ? [{ channel: { in: channels } }] : []),
            ],
          },
        ],
      },
    ],
  }
}

export interface InboxItem {
  notification: Notification
  /** True for notifications addressed to this member, false for broadcasts. */
  personal: boolean
  /** Whether this member has read it (for broadcasts: this member, not anyone). */
  read: boolean
}

/**
 * The member's inbox, newest first, with their own read state. Runs with the member's own access
 * rights, so it can never return another member's personal notifications, and the plugin answers
 * `isRead` of each broadcast for this member.
 */
export const getInbox = async (
  payload: Payload,
  user: User,
  { limit = 50 }: { limit?: number } = {},
): Promise<InboxItem[]> => {
  const { docs } = await payload.find({
    collection: 'notifications',
    where: inboxWhere(user),
    sort: '-createdAt',
    depth: 0,
    limit,
    user,
    overrideAccess: false,
  })
  return docs.map((notification) => ({
    notification,
    personal: notification.audience !== 'broadcast',
    read: Boolean(notification.isRead),
  }))
}

/** Number of unread notifications in the member's inbox (for the header bell). */
export const countUnread = async (payload: Payload, user: User): Promise<number> => {
  const items = await getInbox(payload, user, { limit: 200 })
  return items.filter((i) => !i.read).length
}
