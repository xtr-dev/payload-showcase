import { RichText } from '@payloadcms/richtext-lexical/react'

import { markAllNotificationsRead, markNotificationRead } from '@/components/notifications/actions'
import { Badge, Button, Card, cn } from '@/components/ui'
import { formatDate, formatTime } from '@/lib/format'
import { channelName, getInbox } from '@/lib/notifications'
import { getPayloadClient } from '@/lib/payload'
import type { User } from '@/payload-types'

/**
 * The member's in-app inbox: their own notifications (booking confirmations, class reminders)
 * plus broadcasts on the channels they follow, with per-member read state.
 */
export const NotificationsSection = async ({ user }: { user: User }) => {
  const payload = await getPayloadClient()
  const items = await getInbox(payload, user)
  const unread = items.filter((i) => !i.read).length

  return (
    <Card as="section" className="p-6" aria-labelledby="notifications-heading" id="notifications">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 id="notifications-heading" className="text-2xl text-ink">
            Notifications
          </h2>
          <Badge tone={unread ? 'clay' : 'neutral'}>
            <span data-testid="inbox-unread">{unread}</span> unread
          </Badge>
        </div>
        {unread > 0 && (
          <form action={markAllNotificationsRead}>
            <Button type="submit" variant="ghost" size="sm">
              Mark all as read
            </Button>
          </form>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-ink-soft">
          Nothing here yet. Booking confirmations and studio news will show up here.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line" data-testid="inbox">
          {items.map(({ notification: n, personal, read }) => (
            <li
              key={n.id}
              data-testid="notification"
              data-read={read}
              className={cn('relative py-4 pl-5', !read && 'bg-clay-soft/25')}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute top-6 left-1 size-2.5 rounded-full',
                  read ? 'bg-transparent' : 'bg-clay',
                )}
              />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className={cn('text-lg text-ink', !read && 'font-semibold')}>
                    {!read && <span className="sr-only">Unread: </span>}
                    {n.title}
                  </h3>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                    <Badge tone={personal ? 'glaze' : 'neutral'}>
                      {personal ? 'For you' : 'Everyone'}
                    </Badge>
                    <span>{channelName(n.channel)}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={n.createdAt}>
                      {formatDate(n.createdAt)}, {formatTime(n.createdAt)}
                    </time>
                  </p>
                </div>
                {!read && (
                  <form action={markNotificationRead}>
                    <input type="hidden" name="id" value={n.id} />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      aria-label={`Mark “${n.title}” as read`}
                    >
                      Mark as read
                    </Button>
                  </form>
                )}
              </div>
              <RichText data={n.message} className="prose-kiln mt-3 text-base" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
