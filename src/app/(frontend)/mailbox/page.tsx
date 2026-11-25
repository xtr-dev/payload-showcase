import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Alert, Badge, ButtonLink, Card, Container, cn } from '@/components/ui'
import { getCurrentUser } from '@/lib/auth'
import { STUDIO_TIME_ZONE } from '@/lib/format'
import { isMailCaptured, MAIL_OUTBOX_SLUG } from '@/lib/mailOutbox'
import { getPayloadClient } from '@/lib/payload'

export const metadata: Metadata = { title: 'Demo mailbox', robots: { index: false } }

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: STUDIO_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

/**
 * The demo mailbox: email captured by the development transport instead of being sent (see
 * src/plugins/mailing.ts). Members see mail addressed to them, admins see all of it. The page
 * does not exist when real SMTP delivery is configured.
 */
export default async function MailboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!isMailCaptured()) notFound()
  const user = await getCurrentUser()
  const params = await searchParams
  const payload = await getPayloadClient()

  if (!user) {
    return (
      <Container className="py-12 lg:py-16">
        <h1 className="text-4xl text-ink sm:text-5xl">Demo mailbox</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-soft">
          Kiln &amp; Co. doesn’t send real email in this demo. Every message is captured instead,
          and you can read the ones addressed to you here.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/login?next=%2Fmailbox">Sign in</ButtonLink>
          <ButtonLink href="/register" variant="outline">
            Create an account
          </ButtonLink>
        </div>
      </Container>
    )
  }

  const isAdmin = user.role === 'admin'
  const { docs: messages } = await payload.find({
    collection: MAIL_OUTBOX_SLUG,
    sort: '-createdAt',
    limit: 50,
    user,
    overrideAccess: false,
  })
  // Upcoming mail (scheduled reminders and newsletters). Members can't read the `emails`
  // collection, so this lists only subject and time, and only their own.
  const { docs: upcoming } = await payload.find({
    collection: 'emails',
    where: {
      and: [
        { status: { equals: 'pending' } },
        { scheduledAt: { greater_than: new Date().toISOString() } },
        ...(isAdmin ? [] : [{ recipient: { equals: user.id } }]),
      ],
    },
    select: { subject: true, scheduledAt: true, to: true },
    sort: 'scheduledAt',
    limit: 20,
    overrideAccess: true,
  })

  const selectedId = typeof params.id === 'string' ? Number(params.id) : undefined
  const selected = messages.find((m) => m.id === selectedId) ?? messages[0]

  return (
    <Container className="py-12 lg:py-16">
      <p className="text-sm font-semibold tracking-[0.14em] text-clay uppercase">
        Captured, not sent
      </p>
      <h1 className="mt-2 text-4xl text-ink sm:text-5xl">Demo mailbox</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">
        {isAdmin
          ? 'Every email the site has sent, as the capturing transport received it.'
          : `Email sent to ${user.email}. In this demo nothing leaves the server: the mail transport stores each message here instead.`}
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-8">
          <Card as="section" className="p-4" aria-labelledby="inbox-heading">
            <h2 id="inbox-heading" className="px-2 text-2xl text-ink">
              Inbox <span className="text-base text-ink-soft">({messages.length})</span>
            </h2>
            {messages.length === 0 ? (
              <p className="mt-3 px-2 text-ink-soft">
                Nothing yet. Book a workshop or subscribe to the newsletter in{' '}
                <Link href="/account#settings" className="font-semibold text-clay hover:underline">
                  My studio
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-3 space-y-1" aria-label="Captured emails">
                {messages.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/mailbox?id=${m.id}`}
                      aria-current={m.id === selected?.id ? 'true' : undefined}
                      className={cn(
                        'block rounded-xl px-3 py-2.5 hover:bg-bisque',
                        m.id === selected?.id && 'bg-bisque',
                      )}
                    >
                      <span className="block font-semibold text-ink">{m.subject}</span>
                      <span className="block text-sm text-ink-soft">
                        {isAdmin && <>{m.to.join(', ')} · </>}
                        {when(m.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card as="section" tone="bisque" className="p-6" aria-labelledby="scheduled-heading">
            <h2 id="scheduled-heading" className="text-2xl text-ink">
              Scheduled
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Queued in Payload’s job queue and held until their send time.
            </p>
            {upcoming.length === 0 ? (
              <p className="mt-3 text-ink-soft">No scheduled email.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {upcoming.map((e) => (
                  <li key={e.id}>
                    <span className="block font-semibold text-ink">{e.subject}</span>
                    <span className="block text-sm text-ink-soft">
                      {isAdmin && <>{e.to?.join(', ')} · </>}
                      {e.scheduledAt && when(e.scheduledAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {selected ? (
          <Card as="article" className="overflow-hidden" aria-labelledby="message-subject">
            <header className="border-b border-line/70 p-6">
              <h2 id="message-subject" className="text-2xl text-ink">
                {selected.subject}
              </h2>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="font-semibold text-ink">From</dt>
                <dd className="text-ink-soft">{selected.from}</dd>
                <dt className="font-semibold text-ink">To</dt>
                <dd className="text-ink-soft">{selected.to.join(', ')}</dd>
                <dt className="font-semibold text-ink">Captured</dt>
                <dd className="text-ink-soft">{when(selected.createdAt)}</dd>
              </dl>
              {selected.headers && Object.keys(selected.headers).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.keys(selected.headers).map((h) => (
                    <Badge key={h} tone="glaze">
                      {h}
                    </Badge>
                  ))}
                </div>
              )}
            </header>
            {/* An empty sandbox: no scripts, forms or same-origin access for the email HTML. */}
            <iframe
              title={`Email: ${selected.subject}`}
              sandbox=""
              srcDoc={selected.html ?? ''}
              className="h-[640px] w-full bg-paper"
            />
            {selected.text && (
              <details className="border-t border-line/70 p-6">
                <summary className="cursor-pointer font-semibold text-ink">Plain-text part</summary>
                <pre className="mt-3 font-mono text-sm whitespace-pre-wrap text-ink-soft">
                  {selected.text}
                </pre>
              </details>
            )}
          </Card>
        ) : (
          <Alert tone="info" title="No email yet">
            Messages show up here as soon as the site sends them.
          </Alert>
        )}
      </div>
    </Container>
  )
}
