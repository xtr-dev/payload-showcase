import Link from 'next/link'

import { Badge } from '@/components/ui'
import { STUDIO_TIME_ZONE } from '@/lib/format'
import { findUpcomingNewsletter } from '@/lib/mailing'
import { isMailCaptured } from '@/lib/mailOutbox'
import { getPayloadClient } from '@/lib/payload'
import type { User } from '@/payload-types'

import { NewsletterForm } from './NewsletterForm'

/** Newsletter opt-in. Phase 2 (mailing) owns this file. */
export const NewsletterSetting = async ({ user }: { user: User }) => {
  const payload = await getPayloadClient()
  // Read the flag fresh: after the opt-in action re-renders this page, `user` can still be the
  // copy cached for the request before the change.
  const current = await payload.findByID({
    collection: 'users',
    id: user.id,
    depth: 0,
    user,
    overrideAccess: false,
  })
  const subscribed = !!current.newsletter
  const upcoming = await findUpcomingNewsletter(payload)
  const nextIssue = upcoming?.scheduledAt
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: STUDIO_TIME_ZONE,
        day: 'numeric',
        month: 'long',
      }).format(new Date(upcoming.scheduledAt))
    : null

  return (
    <div className="rounded-xl border border-line/70 bg-paper/60 p-4" data-setting="newsletter">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-sans text-base font-semibold text-ink">Studio newsletter</h3>
        <Badge tone={subscribed ? 'success' : 'neutral'}>
          {subscribed ? 'Subscribed' : 'Not subscribed'}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Studio notes once a month: new classes, glazes and open-studio hours.
        {nextIssue && <> The next issue goes out on {nextIssue}.</>}
      </p>
      <NewsletterForm subscribed={subscribed} />
      {isMailCaptured() && (
        <p className="mt-3 text-sm text-ink-soft">
          This demo doesn’t send real email.{' '}
          <Link href="/mailbox" className="font-semibold text-clay hover:underline">
            Open your demo mailbox
          </Link>
        </p>
      )}
    </div>
  )
}
