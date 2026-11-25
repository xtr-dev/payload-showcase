import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { Emails, mailingPlugin } from '@xtr-dev/payload-mailing'
import type {
  CollectionAfterChangeHook,
  CollectionConfig,
  EmailAdapter,
  Payload,
  Plugin,
  SendEmailOptions,
} from 'payload'

import { getUser, isAdmin, isAdminUser } from '@/access'
import { kilnEmailLayout } from '@/lib/emailLayout'
import {
  absoluteLinks,
  applyNewsletterChange,
  cancelPendingBookingEmails,
  MAIL_QUEUES,
  scheduleClassReminder,
  sendBookingConfirmation,
  sendWelcomeEmail,
  siteUrl,
  TEMPLATES,
} from '@/lib/mailing'
import { isMailCaptured, MAIL_OUTBOX_SLUG } from '@/lib/mailOutbox'
import type { Booking, User } from '@/payload-types'

import { addFields, extendCollection } from './utils'

/**
 * @xtr-dev/payload-mailing
 *
 * Booking confirmation and reminder emails from templates, a welcome email and a scheduled
 * newsletter. Development and tests use a capturing transport; set SMTP_HOST to send for real.
 *
 * Environment (all optional, see .env.example):
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS: deliver through SMTP instead of capturing.
 * - MAIL_FROM: sender, e.g. `Kiln & Co. <hello@kiln.test>`.
 * - DISABLE_JOBS_AUTORUN=true: don't run the job queues on a cron (the tests drain them).
 */

const parseFrom = (value: string | undefined) => {
  const match = value?.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (match) return { name: match[1].trim() || 'Kiln & Co.', address: match[2].trim() }
  return { name: 'Kiln & Co.', address: value?.trim() || 'hello@kiln.test' }
}

const FROM = parseFrom(process.env.MAIL_FROM)

type Recipients = SendEmailOptions['to']

/** Flattens nodemailer-style recipients (string, address object or a list) to plain addresses. */
const toAddresses = (value: Recipients): string[] => {
  if (!value) return []
  const list: unknown[] = Array.isArray(value) ? value.flat() : [value]
  return list.flatMap((item) => {
    if (typeof item === 'string') {
      return item
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    const address = (item as { address?: unknown } | null)?.address
    return typeof address === 'string' ? [address] : []
  })
}

const fromLabel = (from: SendEmailOptions['from']): string => {
  if (!from) return `${FROM.name} <${FROM.address}>`
  return typeof from === 'string' ? from : `${from.name ?? ''} <${from.address}>`.trim()
}

/**
 * A Payload email adapter that delivers nothing: it stores each outgoing message in the
 * `mail-outbox` collection, so development, tests and the demo can show exactly what would
 * have been sent (see the /mailbox page).
 */
const captureAdapter: EmailAdapter = ({ payload }) => ({
  name: 'kiln-capture',
  defaultFromAddress: FROM.address,
  defaultFromName: FROM.name,
  sendEmail: async (message) => {
    const doc = await payload.create({
      collection: MAIL_OUTBOX_SLUG,
      data: {
        to: toAddresses(message.to),
        cc: toAddresses(message.cc),
        from: fromLabel(message.from),
        subject: String(message.subject ?? ''),
        html: typeof message.html === 'string' ? message.html : '',
        text: typeof message.text === 'string' ? message.text : '',
        headers: (message.headers as Record<string, string> | undefined) ?? {},
      },
      overrideAccess: true,
    })
    return { messageId: `captured-${doc.id}` }
  },
})

const emailAdapter = isMailCaptured()
  ? captureAdapter
  : nodemailerAdapter({
      defaultFromAddress: FROM.address,
      defaultFromName: FROM.name,
      transportOptions: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      },
    })

/**
 * Captured outgoing mail. Admins see everything; a member sees only mail addressed to them, so
 * the demo mailbox can be public without exposing other people's messages.
 */
const MailOutbox: CollectionConfig = {
  slug: MAIL_OUTBOX_SLUG,
  labels: { singular: 'Captured email', plural: 'Dev outbox' },
  admin: {
    group: 'Mailing',
    useAsTitle: 'subject',
    defaultColumns: ['subject', 'to', 'createdAt'],
    description:
      'Mail captured by the development transport instead of being sent. Empty when SMTP is configured.',
    preview: (doc) => `${siteUrl()}/mailbox?id=${doc.id}`,
  },
  access: {
    read: ({ req }) => {
      const user = getUser(req)
      if (!user) return false
      if (isAdminUser(user)) return true
      return { to: { equals: user.email } }
    },
    create: () => false,
    update: () => false,
    delete: isAdmin,
  },
  fields: [
    { name: 'subject', type: 'text', required: true },
    { name: 'to', type: 'text', hasMany: true, required: true, index: true },
    { name: 'cc', type: 'text', hasMany: true },
    { name: 'from', type: 'text' },
    { name: 'html', type: 'code', admin: { language: 'html' } },
    { name: 'text', type: 'textarea' },
    { name: 'headers', type: 'json' },
  ],
  timestamps: true,
}

const withEmailTransport: Plugin = (config) => ({
  ...config,
  email: config.email ?? emailAdapter,
  collections: [...(config.collections ?? []), MailOutbox],
})

/**
 * Runs the mail queues on a cron. Merges with any `jobs` config other plugins (automation)
 * set, instead of replacing it.
 */
const withMailJobRunner: Plugin = (config) => {
  const jobs = config.jobs ?? {}
  const ours = [
    // Booking confirmations: checked every 5 seconds so they arrive right after booking.
    { cron: '*/5 * * * * *', queue: MAIL_QUEUES.priority, limit: 10 },
    // Everything else, including scheduled reminders and newsletters once they are due.
    { cron: '*/15 * * * * *', queue: MAIL_QUEUES.default, limit: 25 },
  ]
  const existing = jobs.autoRun
  const previousShouldAutoRun = jobs.shouldAutoRun
  return {
    ...config,
    jobs: {
      ...jobs,
      autoRun:
        typeof existing === 'function'
          ? async (payload) => [...(await existing(payload)), ...ours]
          : [...(existing ?? []), ...ours],
      shouldAutoRun: async (payload) =>
        process.env.DISABLE_JOBS_AUTORUN !== 'true' &&
        (previousShouldAutoRun ? await previousShouldAutoRun(payload) : true),
    },
  }
}

/** Whether a template exists yet: the core seed creates bookings before templates are seeded. */
const hasTemplate = async (payload: Payload, slug: string): Promise<boolean> => {
  const { totalDocs } = await payload.count({
    collection: 'email-templates',
    where: { slug: { equals: slug } },
    overrideAccess: true,
  })
  return totalDocs > 0
}

/** A booking is confirmed once: a later paid transition (e.g. after a refund) doesn't resend. */
const hasConfirmation = async (payload: Payload, bookingId: number): Promise<boolean> => {
  const { totalDocs } = await payload.count({
    collection: 'emails',
    where: {
      booking: { equals: bookingId },
      templateSlug: { equals: TEMPLATES.bookingConfirmation },
    },
    overrideAccess: true,
  })
  return totalDocs > 0
}

/** Set `context: { skipMail: true }` on a write to suppress the emails its hooks would send. */
const skipMail = (context: Record<string, unknown>) => context.skipMail === true

/**
 * Booking emails, sent by site code. A booking starts `pending` and billing moves it to `paid`
 * once its payment settles (a free seat is marked paid straight away). On that transition the
 * member gets the confirmation and a reminder is scheduled 24 hours before the session. When the
 * booking is cancelled or refunded, the pending reminder is withdrawn. Mail problems are logged
 * and never block the booking itself.
 */
const bookingEmails: CollectionAfterChangeHook<Booking> = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  const { payload } = req
  if (skipMail(req.context)) return doc
  const before = operation === 'create' ? undefined : previousDoc?.status
  if (before === doc.status) return doc
  try {
    if (
      doc.status === 'paid' &&
      (await hasTemplate(payload, TEMPLATES.bookingConfirmation)) &&
      !(await hasConfirmation(payload, doc.id))
    ) {
      await sendBookingConfirmation(payload, doc)
      if (await hasTemplate(payload, TEMPLATES.classReminder)) {
        await scheduleClassReminder(payload, doc)
      }
    }
    if (doc.status === 'cancelled' || doc.status === 'refunded') {
      await cancelPendingBookingEmails(payload, doc.id)
    }
  } catch (error) {
    payload.logger.error({ err: error, msg: `Booking email for ${doc.reference} failed` })
  }
  return doc
}

/** Welcome email on registration, and newsletter opt-in/opt-out side effects. */
const memberEmails: CollectionAfterChangeHook<User> = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  const { payload } = req
  if (skipMail(req.context)) return doc
  try {
    if (operation === 'create' && (await hasTemplate(payload, TEMPLATES.welcome))) {
      await sendWelcomeEmail(payload, doc)
    }
    const changed =
      operation === 'create' ? !!doc.newsletter : !!previousDoc?.newsletter !== !!doc.newsletter
    if (changed && (await hasTemplate(payload, TEMPLATES.newsletterSubscribed))) {
      await applyNewsletterChange(payload, doc)
    }
  } catch (error) {
    payload.logger.error({ err: error, msg: `Member email for user ${doc.id} failed` })
  }
  return doc
}

const relId = (value: unknown): number | string | undefined => {
  if (value && typeof value === 'object' && 'id' in value) return (value as { id: number }).id
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}

const staffOnly = { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin }

export const mailing: Plugin[] = [
  withEmailTransport,
  mailingPlugin({
    defaultFrom: FROM.address,
    defaultFromName: FROM.name,
    // Ordinary sends go to the `mail` queue; `sendBookingConfirmation` overrides it per send.
    queue: MAIL_QUEUES.default,
    templateEngine: 'liquidjs',
    // A broken template should fail the send loudly instead of mailing raw `{{ tags }}`.
    strictTemplates: true,
    locale: 'en-GB',
    currency: 'EUR',
    timeZone: 'Europe/Amsterdam',
    layouts: { kiln: kilnEmailLayout },
    defaultLayout: 'kiln',
    retryAttempts: 3,
    // Email bodies can't show uploads or embedded relationships, so the template editor
    // leaves those features out. Links (including internal links to workshops) stay.
    richTextEditor: lexicalEditor({
      features: ({ defaultFeatures }) =>
        defaultFeatures.filter((feature) => !['upload', 'relationship'].includes(feature.key)),
    }),
    // Internal links in a template become absolute site URLs.
    resolveInternalLink: ({ doc }) => {
      const value = doc?.value
      if (
        doc?.relationTo === 'workshops' &&
        value &&
        typeof value === 'object' &&
        'slug' in value
      ) {
        return `${siteUrl()}/workshops/${String(value.slug)}`
      }
      return null
    },
    // Runs just before delivery: makes the templates' site-relative links absolute, and gives
    // newsletter emails the standard List-Unsubscribe header.
    beforeSend: (options, email) => ({
      ...options,
      html: typeof options.html === 'string' ? absoluteLinks(options.html, 'html') : options.html,
      text: typeof options.text === 'string' ? absoluteLinks(options.text, 'text') : options.text,
      headers:
        email.templateSlug === TEMPLATES.newsletter
          ? {
              ...(options.headers as Record<string, string> | undefined),
              'List-Unsubscribe': `<${siteUrl()}/account#settings>`,
            }
          : options.headers,
    }),
    collections: {
      templates: { access: staffOnly },
      emails: {
        access: staffOnly,
        // Custom fields on top of the plugin's: which booking and member an email belongs to,
        // so reminders can be withdrawn and newsletter opt-outs honoured.
        fields: [
          ...Emails.fields,
          {
            name: 'booking',
            type: 'relationship',
            relationTo: 'bookings',
            index: true,
            admin: { position: 'sidebar', readOnly: true },
          },
          {
            name: 'recipient',
            type: 'relationship',
            relationTo: 'users',
            index: true,
            admin: { position: 'sidebar', readOnly: true },
          },
        ],
      },
    },
  }),
  withMailJobRunner,
  // payload-mailing 0.7.0 fills `templateSlug` only when the template id is a string, so with
  // SQLite's numeric ids it stays empty. This hook runs after the plugin's and fills it in.
  extendCollection('emails', (collection) => ({
    ...collection,
    hooks: {
      ...collection.hooks,
      beforeChange: [
        ...(collection.hooks?.beforeChange ?? []),
        async ({ data, req }) => {
          const templateId = relId(data.template)
          if (templateId !== undefined && !data.templateSlug) {
            const template = await req.payload.findByID({
              collection: 'email-templates',
              id: templateId,
              depth: 0,
              overrideAccess: true,
              req,
            })
            data.templateSlug = template.slug
          }
          return data
        },
      ],
    },
  })),
  addFields('users', [
    {
      name: 'newsletter',
      type: 'checkbox',
      label: 'Studio newsletter',
      defaultValue: false,
      admin: { position: 'sidebar', description: 'Receives the monthly studio newsletter.' },
    },
  ]),
  extendCollection('users', (collection) => ({
    ...collection,
    hooks: {
      ...collection.hooks,
      afterChange: [...(collection.hooks?.afterChange ?? []), memberEmails],
    },
  })),
  extendCollection('bookings', (collection) => ({
    ...collection,
    hooks: {
      ...collection.hooks,
      afterChange: [...(collection.hooks?.afterChange ?? []), bookingEmails],
    },
  })),
]
