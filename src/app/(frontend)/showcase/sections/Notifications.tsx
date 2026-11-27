import { RichText } from '@payloadcms/richtext-lexical/react'

import { Alert, Badge, Card } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { CHANNELS, channelName, vapidKeys } from '@/lib/notifications'
import { getPayloadClient } from '@/lib/payload'

import { ShowcaseSection } from '../ShowcaseSection'

const SNIPPET = `import { notifyMember } from '@/lib/notifications'

await notifyMember(payload, booking.member, {
  title: 'Booking confirmed',
  channel: 'bookings',
  message: 'See you at Wheel Throwing on Saturday.',
})`

/** Showcase for @xtr-dev/payload-notifications: the latest studio broadcasts, live. */
export const NotificationsShowcase = async () => {
  const payload = await getPayloadClient()
  // Broadcasts only: personal notifications never leave the member's own inbox.
  const { docs: broadcasts } = await payload.find({
    collection: 'notifications',
    where: { audience: { equals: 'broadcast' } },
    sort: '-createdAt',
    depth: 0,
    limit: 2,
    overrideAccess: true,
  })
  const pushOn = Boolean(vapidKeys())

  return (
    <ShowcaseSection
      id="notifications"
      pkg="@xtr-dev/payload-notifications"
      title="An inbox for members"
      intro="Members get in-app notifications for bookings, reminders and studio news, with a header bell, channels they choose, and optional web push."
      features={[
        'Personal notifications (“booking confirmed”, sent when a booking is paid or refunded) and broadcasts (“kiln firing schedule changed”)',
        'Rich-text messages written by staff in the Payload admin',
        'Read and unread state, an unread count in the header and “mark all as read”',
        'Channels (Bookings, Class reminders, Studio news) with per-member opt-outs: the plugin’s channel subscriptions, changed in the account settings or over REST',
        'Optional web push via the plugin’s service worker, switched on by VAPID keys',
      ]}
      usedOn={[
        ['My studio inbox', '/account#notifications'],
        ['Channel and push settings', '/account#settings'],
      ]}
      status="live"
      tone="paper"
    >
      <div className="space-y-6">
        <Card as="section" className="p-6" aria-labelledby="notifications-demo-heading">
          <h3 id="notifications-demo-heading" className="text-xl text-ink">
            Latest studio broadcasts
          </h3>
          {broadcasts.length === 0 ? (
            <p className="mt-3 text-ink-soft">
              No broadcasts yet. Run <code className="font-mono">pnpm seed</code> for demo data.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line" data-testid="showcase-broadcasts">
              {broadcasts.map((n) => (
                <li key={n.id} className="py-4">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                    <Badge>{channelName(n.channel)}</Badge>
                    <time dateTime={n.createdAt}>{formatDate(n.createdAt)}</time>
                  </p>
                  <p className="mt-2 font-semibold text-ink">{n.title}</p>
                  <RichText data={n.message} className="prose-kiln mt-2 text-base" />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm text-ink-soft">
            Sign in as <code className="font-mono">mara@kiln.test</code> (password{' '}
            <code className="font-mono">kiln-member</code>) to see her inbox with personal
            notifications and the unread count in the header.
          </p>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <p className="font-semibold text-ink">Channels</p>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              {CHANNELS.map((c) => (
                <li key={c.id}>
                  <span className="font-semibold text-ink">{c.name}</span>
                  {c.optional ? '' : ' (always on)'}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5">
            <p className="font-semibold text-ink">Web push on this server</p>
            <p className="mt-2 text-sm text-ink-soft" data-testid="showcase-push-status">
              {pushOn
                ? 'On: members can subscribe their devices in My studio → Settings.'
                : 'Off: no VAPID keys are set, so the plugin registers no push endpoints and the inbox works on its own.'}
            </p>
          </Card>
        </div>

        <div>
          <p className="text-sm font-semibold text-ink">
            Other plugins notify members with one call:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-card bg-ink p-4 font-mono text-sm text-paper">
            <code>{SNIPPET}</code>
          </pre>
        </div>

        <Alert tone="info" title="Read state per member">
          A broadcast is one notification shown to every member, so the plugin keeps its read state
          per member in <code className="font-mono">notification-reads</code> and answers{' '}
          <code className="font-mono">isRead</code> for whoever is asking. The inbox marks
          notifications read and unread through the plugin’s <code className="font-mono">POST</code>
          /<code className="font-mono">DELETE</code>{' '}
          <code className="font-mono">/api/notifications/:id/read</code> endpoint.
        </Alert>
      </div>
    </ShowcaseSection>
  )
}
