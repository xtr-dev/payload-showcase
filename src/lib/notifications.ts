import type { Payload, PayloadRequest, Where } from 'payload'

import type { Notification, User } from '@/payload-types'

import { richText, type RichTextValue } from './richtext'

/**
 * Server-side helpers for the member inbox (@xtr-dev/payload-notifications).
 *
 * The plugin stores a notification with a `recipient` as a personal message and one without a
 * recipient as a broadcast. Its `isRead` flag lives on the notification row, so for a broadcast it
 * would be shared by every member. The site therefore keeps the plugin's `isRead`/`readAt` for
 * personal notifications and records broadcast reads per member in `notification-reads`
 * (see src/plugins/notifications.ts).
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

const idOf = (value: number | { id: number } | null | undefined): number | null =>
  value == null ? null : typeof value === 'object' ? value.id : value

export interface NotifyOptions {
  title: string
  /** Plain text (blank lines start a new paragraph) or Lexical rich text. */
  message: MessageInput
  channel?: ChannelId
  /** Pass the hook's `req` when calling from inside a Payload hook, to share its transaction. */
  req?: PayloadRequest
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
  { title, message, channel = 'bookings', req }: NotifyOptions,
): Promise<Notification> =>
  payload.create({
    collection: 'notifications',
    data: { title, message: toRichText(message), channel, recipient: Number(userId) },
    req,
  })

/**
 * Sends a broadcast to every member who follows `channel`, e.g. "Kiln firing schedule changed".
 * Broadcasts have no recipient; each member's read state is kept in `notification-reads`.
 */
export const broadcast = (
  payload: Payload,
  { title, message, channel = 'studio-news', req }: NotifyOptions,
): Promise<Notification> =>
  payload.create({
    collection: 'notifications',
    data: { title, message: toRichText(message), channel },
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
          { recipient: { exists: false } },
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
  read: boolean
}

/** Ids of the broadcasts this member has marked as read. */
const readBroadcastIds = async (payload: Payload, user: User): Promise<Set<number>> => {
  const { docs } = await payload.find({
    collection: 'notification-reads',
    where: { user: { equals: user.id } },
    depth: 0,
    pagination: false,
    user,
    overrideAccess: false,
  })
  return new Set(docs.map((r) => idOf(r.notification)).filter((id): id is number => id !== null))
}

/**
 * The member's inbox, newest first, with per-member read state. Runs with the member's own access
 * rights, so it can never return another member's personal notifications.
 */
export const getInbox = async (
  payload: Payload,
  user: User,
  { limit = 50 }: { limit?: number } = {},
): Promise<InboxItem[]> => {
  const [{ docs }, readBroadcasts] = await Promise.all([
    payload.find({
      collection: 'notifications',
      where: inboxWhere(user),
      sort: '-createdAt',
      depth: 0,
      limit,
      user,
      overrideAccess: false,
    }),
    readBroadcastIds(payload, user),
  ])
  return docs.map((notification) => {
    const personal = idOf(notification.recipient) !== null
    return {
      notification,
      personal,
      read: personal ? Boolean(notification.isRead) : readBroadcasts.has(notification.id),
    }
  })
}

/** Number of unread notifications in the member's inbox (for the header bell). */
export const countUnread = async (payload: Payload, user: User): Promise<number> => {
  const items = await getInbox(payload, user, { limit: 200 })
  return items.filter((i) => !i.read).length
}

/**
 * Marks one inbox notification as read for this member. Personal notifications use the plugin's
 * own `isRead`/`readAt` fields (members may only change those two); broadcasts get a read receipt.
 * Returns false when the notification isn't in the member's inbox.
 */
export const markRead = async (
  payload: Payload,
  user: User,
  notificationId: number,
): Promise<boolean> => {
  const { docs } = await payload.find({
    collection: 'notifications',
    where: { and: [{ id: { equals: notificationId } }, inboxWhere(user)] },
    depth: 0,
    limit: 1,
    user,
    overrideAccess: false,
  })
  const notification = docs[0]
  if (!notification) return false

  if (idOf(notification.recipient) !== null) {
    if (!notification.isRead) {
      await payload.update({
        collection: 'notifications',
        id: notification.id,
        data: { isRead: true, readAt: new Date().toISOString() },
        user,
        overrideAccess: false,
      })
    }
    return true
  }

  const existing = await payload.count({
    collection: 'notification-reads',
    where: { and: [{ user: { equals: user.id } }, { notification: { equals: notification.id } }] },
    user,
    overrideAccess: false,
  })
  if (existing.totalDocs === 0) {
    await payload.create({
      collection: 'notification-reads',
      data: { user: user.id, notification: notification.id },
      user,
      overrideAccess: false,
    })
  }
  return true
}

/** Marks everything in the member's inbox as read. Returns how many were unread. */
export const markAllRead = async (payload: Payload, user: User): Promise<number> => {
  const unread = (await getInbox(payload, user, { limit: 200 })).filter((i) => !i.read)
  for (const item of unread) await markRead(payload, user, item.notification.id)
  return unread.length
}

/** Plain-text excerpt of a notification message, for push bodies and previews. */
export const messageText = (message: unknown): string => {
  const walk = (node: unknown): string => {
    if (!node || typeof node !== 'object') return ''
    const n = node as { text?: unknown; children?: unknown[]; root?: unknown; type?: string }
    if (n.root) return walk(n.root)
    if (typeof n.text === 'string') return n.text
    if (!Array.isArray(n.children)) return ''
    const sep = n.type === 'root' || n.type === 'list' ? ' ' : ''
    return n.children.map(walk).join(sep)
  }
  return walk(message).replace(/\s+/g, ' ').trim()
}
