import { renderTemplate } from '@xtr-dev/payload-mailing'
import Link from 'next/link'
import type { Where } from 'payload'

import { Alert, Card } from '@/components/ui'
import { TEMPLATES } from '@/lib/mailing'
import { isMailCaptured, MAIL_OUTBOX_SLUG } from '@/lib/mailOutbox'
import { getPayloadClient } from '@/lib/payload'

import { ShowcaseSection } from '../ShowcaseSection'

const SNIPPET = `// src/lib/mailing.ts
await sendEmail<Email>(payload, {
  template: { slug: 'booking-confirmation', variables },
  data: { to: [member.email], priority: 1, booking: booking.id },
  queue: 'mail-priority',
})`

/** Renders the booking confirmation from its admin-edited template, with its sample variables. */
const loadPreview = async () => {
  const payload = await getPayloadClient()
  const { docs } = await payload.find({
    collection: 'email-templates',
    where: { slug: { equals: TEMPLATES.bookingConfirmation } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const template = docs[0]
  if (!template) return null
  const variables = (template.sampleVariables ?? {}) as Record<string, unknown>
  const rendered = await renderTemplate(payload, template.slug, variables)

  const count = (where: Where) =>
    payload.count({ collection: 'emails', where, overrideAccess: true }).then((r) => r.totalDocs)
  const [sent, scheduled, captured] = await Promise.all([
    count({ status: { equals: 'sent' } }),
    count({
      status: { equals: 'pending' },
      scheduledAt: { greater_than: new Date().toISOString() },
    }),
    payload.count({ collection: MAIL_OUTBOX_SLUG, overrideAccess: true }).then((r) => r.totalDocs),
  ])
  return { rendered, stats: { sent, scheduled, captured } }
}

/** Showcase for @xtr-dev/payload-mailing. Phase 2 owns this file. */
export const MailingShowcase = async () => {
  const preview = await loadPreview()
  return (
    <ShowcaseSection
      id="mailing"
      pkg="@xtr-dev/payload-mailing"
      title="Emails from templates"
      intro="Booking confirmations, class reminders, a welcome email and a monthly newsletter, written as rich-text templates in the admin panel and delivered through Payload’s job queue."
      features={[
        'Five Liquid templates with variables, filters and conditionals, wrapped in a shared Kiln & Co. layout',
        'Rich-text template editing in the admin panel, with a live preview from sample variables',
        'Booking confirmations sent from site code with sendEmail when payment settles, on their own priority queue',
        'Class reminders scheduled 24 hours before each session, and the newsletter scheduled for the 1st of the month',
        'Queued delivery through Payload jobs; processImmediately for the newsletter confirmation',
        'Newsletter opt-in and opt-out in My studio, honoured for issues that are already scheduled',
        'Captured locally in development: no SMTP needed',
      ]}
      usedOn={[
        ['My studio settings', '/account#settings'],
        ['Demo mailbox', '/mailbox'],
        ['Email templates (admin)', '/admin/collections/email-templates'],
      ]}
      status="live"
      tone="bisque"
    >
      {preview ? (
        <div className="space-y-6">
          <dl className="grid grid-cols-3 gap-3">
            {(
              [
                ['Sent', preview.stats.sent],
                ['Scheduled', preview.stats.scheduled],
                ['Captured', preview.stats.captured],
              ] as const
            ).map(([label, value]) => (
              <Card key={label} tone="paper" className="p-4 text-center">
                <dt className="text-sm font-semibold text-ink-soft">{label}</dt>
                <dd className="font-display text-3xl text-ink">{value}</dd>
              </Card>
            ))}
          </dl>

          <Card as="section" className="overflow-hidden" aria-label="Booking confirmation preview">
            <div className="border-b border-line/70 px-5 py-3 text-sm">
              <span className="font-semibold text-ink">{preview.rendered.subject}</span>
              <span className="block text-ink-soft">
                The <code className="font-mono">booking-confirmation</code> template, rendered with
                its sample variables
              </span>
            </div>
            <iframe
              title="Booking confirmation email preview"
              sandbox=""
              srcDoc={preview.rendered.html}
              className="h-[520px] w-full bg-paper"
            />
          </Card>

          <pre className="overflow-x-auto rounded-card bg-ink p-5 font-mono text-sm text-paper">
            <code>{SNIPPET}</code>
          </pre>

          {isMailCaptured() && (
            <p className="text-sm text-ink-soft">
              Book a workshop or subscribe in My studio, then open the{' '}
              <Link href="/mailbox" className="font-semibold text-clay hover:underline">
                demo mailbox
              </Link>{' '}
              to read what was sent.
            </p>
          )}
        </div>
      ) : (
        <Alert tone="info" title="No templates yet">
          Run <code className="font-mono">pnpm seed</code> to create the email templates.
        </Alert>
      )}
    </ShowcaseSection>
  )
}
