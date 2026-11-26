import Link from 'next/link'

import { countUnread } from '@/lib/notifications'
import { getPayloadClient } from '@/lib/payload'
import type { User } from '@/payload-types'

/** Header bell with the member's unread count; links to their inbox in the account area. */
export const NotificationBell = async ({ user }: { user: User }) => {
  const unread = await countUnread(await getPayloadClient(), user)
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications'

  return (
    <Link
      href="/account#notifications"
      aria-label={label}
      title={label}
      data-testid="notification-bell"
      className="relative inline-flex size-10 items-center justify-center rounded-pill text-ink transition-colors hover:bg-ink/5"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor">
        <path
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0"
        />
      </svg>
      {unread > 0 && (
        <span
          aria-hidden
          data-testid="notification-count"
          className="absolute -top-0.5 -right-0.5 min-w-5 rounded-pill bg-clay px-1.5 text-center text-xs leading-5 font-semibold text-white"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
