import { ImmediateProcessingError, sendEmail } from '@xtr-dev/payload-mailing'
import type { Payload, Where } from 'payload'

import type { Booking, Email, Session, User, Workshop } from '@/payload-types'

import { formatDuration, formatTime, STUDIO_TIME_ZONE } from './format'

/**
 * Site-side email API for Kiln & Co., built on `sendEmail` from @xtr-dev/payload-mailing.
 *
 * Every function takes the Payload instance first so it can be called from hooks, server
 * actions, seeds, tests and other plugins (the automation workflows call
 * `sendBookingConfirmation`). Emails are rendered from the templates in the `email-templates`
 * collection, queued in the plugin's `emails` collection and delivered by the `process-email`
 * job; see src/plugins/mailing.ts for the transport and the job runner.
 */

/** Slugs of the templates seeded by src/seed/mailing.ts. */
export const TEMPLATES = {
  bookingConfirmation: 'booking-confirmation',
  classReminder: 'class-reminder',
  welcome: 'welcome',
  newsletter: 'newsletter',
  newsletterSubscribed: 'newsletter-subscribed',
} as const

/**
 * Job queues used for mail. Ordinary sends use `mail` (the plugin's `queue` option); booking
 * confirmations are routed to `mail-priority` per send. Both are drained by `jobs.autoRun`.
 */
export const MAIL_QUEUES = { default: 'mail', priority: 'mail-priority' } as const

/** How long before a session its reminder is sent. */
export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000

/** Public origin used for links in emails. */
export const siteUrl = (): string =>
  (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/, '')

/** Variables every template and the Kiln & Co. layout rely on. */
const baseVariables = (preheader: string) => ({ siteUrl: siteUrl(), preheader })

const firstName = (user: Pick<User, 'name'>): string => user.name.split(' ')[0] || user.name

const relId = (value: unknown): number | undefined => {
  if (value && typeof value === 'object' && 'id' in value) return (value as { id: number }).id
  return typeof value === 'number' ? value : undefined
}

const sessionDateLabel = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: STUDIO_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso))

interface BookingParts {
  booking: Booking
  member: User
  session: Session
  workshop: Workshop
}

/** Loads a booking with its member, session and workshop, whatever depth the caller had. */
const loadBooking = async (payload: Payload, booking: Booking | number): Promise<BookingParts> => {
  const id = typeof booking === 'number' ? booking : booking.id
  const doc = await payload.findByID({ collection: 'bookings', id, depth: 1, overrideAccess: true })
  const member =
    typeof doc.member === 'object' && doc.member
      ? doc.member
      : await payload.findByID({ collection: 'users', id: relId(doc.member)!, depth: 0 })
  const session =
    typeof doc.session === 'object'
      ? doc.session
      : await payload.findByID({ collection: 'sessions', id: relId(doc.session)!, depth: 0 })
  const workshop =
    typeof doc.workshop === 'object' && doc.workshop
      ? doc.workshop
      : await payload.findByID({
          collection: 'workshops',
          id: relId(doc.workshop ?? session.workshop)!,
          depth: 0,
          draft: true,
        })
  return { booking: doc, member, session, workshop }
}

const bookingVariables = ({ booking, member, session, workshop }: BookingParts) => ({
  firstName: firstName(member),
  workshopTitle: workshop.title,
  instructor: workshop.instructor ?? 'the studio team',
  startsAt: session.startsAt,
  sessionDate: sessionDateLabel(session.startsAt),
  sessionTime: formatTime(session.startsAt),
  duration: formatDuration(workshop.duration ?? 120),
  reference: booking.reference ?? '',
  // In euros: the templates format it with the plugin's `formatCurrency` filter.
  amount: (booking.amount ?? 0) / 100,
  paid: booking.status === 'paid',
})

/**
 * Sends the booking confirmation for a booking, rendered from the `booking-confirmation`
 * template. The bookings hook in src/plugins/mailing.ts calls it when a booking becomes `paid`.
 * The send goes to the `mail-priority` queue with priority 1, so it is delivered before newsletters
 * and reminders. Returns the queued `emails` document.
 */
export const sendBookingConfirmation = async (
  payload: Payload,
  booking: Booking | number,
  { processImmediately = false }: { processImmediately?: boolean } = {},
): Promise<Email> => {
  const parts = await loadBooking(payload, booking)
  return sendEmail<Email>(payload, {
    template: {
      slug: TEMPLATES.bookingConfirmation,
      variables: {
        ...baseVariables(`Your seat in ${parts.workshop.title} is confirmed.`),
        ...bookingVariables(parts),
      },
    },
    data: {
      to: [parts.member.email],
      priority: 1,
      booking: parts.booking.id,
      recipient: parts.member.id,
    },
    queue: MAIL_QUEUES.priority,
    processImmediately,
  })
}

/**
 * Schedules the class reminder for a booking, 24 hours before its session starts. The email is
 * created now (status `pending`, `scheduledAt` set) and its processing job waits until then.
 * Returns null when the session starts within 24 hours, since the confirmation already covers it.
 */
export const scheduleClassReminder = async (
  payload: Payload,
  booking: Booking | number,
): Promise<Email | null> => {
  const parts = await loadBooking(payload, booking)
  const sendAt = new Date(new Date(parts.session.startsAt).getTime() - REMINDER_LEAD_MS)
  if (sendAt.getTime() <= Date.now()) return null
  return sendEmail<Email>(payload, {
    template: {
      slug: TEMPLATES.classReminder,
      variables: {
        ...baseVariables(`See you tomorrow at ${parts.workshop.title}.`),
        ...bookingVariables(parts),
      },
    },
    data: {
      to: [parts.member.email],
      scheduledAt: sendAt.toISOString(),
      priority: 3,
      booking: parts.booking.id,
      recipient: parts.member.id,
    },
  })
}

/** Deletes a booking's emails that have not gone out yet (its reminder), e.g. after cancelling. */
export const cancelPendingBookingEmails = async (
  payload: Payload,
  bookingId: number,
): Promise<number> => {
  const { docs } = await payload.delete({
    collection: 'emails',
    where: { and: [{ booking: { equals: bookingId } }, { status: { equals: 'pending' } }] },
    overrideAccess: true,
  })
  return docs.length
}

/** Sends the welcome email to a newly registered member (queued on the default mail queue). */
export const sendWelcomeEmail = async (
  payload: Payload,
  user: User,
  { processImmediately = false }: { processImmediately?: boolean } = {},
): Promise<Email> =>
  sendEmail<Email>(payload, {
    processImmediately,
    template: {
      slug: TEMPLATES.welcome,
      variables: {
        ...baseVariables('Welcome to the studio. Here is how to get your hands in clay.'),
        firstName: firstName(user),
      },
    },
    data: { to: [user.email], recipient: user.id },
  })

const newsletterVariables = (user: User, sendAt: Date) => ({
  ...baseVariables('News from the studio: fresh glazes, new classes and open-studio hours.'),
  firstName: firstName(user),
  issueDate: sendAt.toISOString(),
})

/** Members who opted in to the newsletter. */
export const findNewsletterSubscribers = async (payload: Payload): Promise<User[]> => {
  const { docs } = await payload.find({
    collection: 'users',
    where: { newsletter: { equals: true } },
    limit: 0,
    depth: 0,
    overrideAccess: true,
  })
  return docs
}

const queueNewsletterFor = (payload: Payload, user: User, sendAt: Date) =>
  sendEmail<Email>(payload, {
    template: { slug: TEMPLATES.newsletter, variables: newsletterVariables(user, sendAt) },
    data: { to: [user.email], scheduledAt: sendAt.toISOString(), priority: 8, recipient: user.id },
  })

/**
 * Schedules the newsletter (the current `newsletter` template) for every subscriber at
 * `sendAt`. Each subscriber gets their own `emails` document with `scheduledAt`, so the issue
 * stays queued until it is due. Members who opt out before then are removed from it (see
 * `setNewsletterSubscription`), and members who opt in are added to it.
 */
export const scheduleNewsletter = async (payload: Payload, sendAt: Date): Promise<Email[]> => {
  const subscribers = await findNewsletterSubscribers(payload)
  const emails: Email[] = []
  for (const user of subscribers) emails.push(await queueNewsletterFor(payload, user, sendAt))
  return emails
}

/** The next newsletter that is scheduled but not sent yet, if any. */
export const findUpcomingNewsletter = async (payload: Payload): Promise<Email | null> => {
  const { docs } = await payload.find({
    collection: 'emails',
    where: {
      and: [
        { templateSlug: { equals: TEMPLATES.newsletter } },
        { status: { equals: 'pending' } },
        { scheduledAt: { greater_than: new Date().toISOString() } },
      ],
    },
    sort: 'scheduledAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return docs[0] ?? null
}

const pendingNewslettersFor = (userId: number): Where => ({
  and: [
    { templateSlug: { equals: TEMPLATES.newsletter } },
    { status: { equals: 'pending' } },
    { recipient: { equals: userId } },
  ],
})

/**
 * Applies the side effects of a newsletter opt-in or opt-out. Called by the users hook in
 * src/plugins/mailing.ts whenever `newsletter` changes, whoever changed it (the member in My
 * studio, or an admin).
 *
 * - Opt-out: deletes the member's newsletter emails that have not been sent yet.
 * - Opt-in: sends a "you're subscribed" email straight away (`processImmediately`), and adds the
 *   member to the upcoming scheduled issue, if there is one.
 */
export const applyNewsletterChange = async (payload: Payload, user: User): Promise<void> => {
  if (!user.newsletter) {
    await payload.delete({
      collection: 'emails',
      where: pendingNewslettersFor(user.id),
      overrideAccess: true,
    })
    return
  }

  const upcoming = await findUpcomingNewsletter(payload)
  const upcomingAt = upcoming?.scheduledAt ? new Date(upcoming.scheduledAt) : null
  if (upcomingAt) {
    const already = await payload.count({
      collection: 'emails',
      where: pendingNewslettersFor(user.id),
      overrideAccess: true,
    })
    if (already.totalDocs === 0) await queueNewsletterFor(payload, user, upcomingAt)
  }

  try {
    await sendEmail<Email>(payload, {
      template: {
        slug: TEMPLATES.newsletterSubscribed,
        variables: {
          ...baseVariables('You are on the list for the Kiln & Co. studio newsletter.'),
          firstName: firstName(user),
          nextIssue: upcomingAt?.toISOString() ?? '',
        },
      },
      data: { to: [user.email], recipient: user.id },
      processImmediately: true,
    })
  } catch (error) {
    // The plugin throws ImmediateProcessingError when the email was created and queued but not
    // delivered inline, for example because the mail server is down. The email is not lost: it
    // is back to pending with a retry job that runs after the plugin's retryDelay, so the opt-in
    // itself has not failed.
    if (!(error instanceof ImmediateProcessingError)) throw error
    payload.logger.warn(
      { err: error.cause, emailId: error.email.id },
      'Newsletter confirmation could not be sent right away; it stays queued for a retry',
    )
  }
}

/** Opts a member in to or out of the newsletter. The users hook applies the side effects. */
export const setNewsletterSubscription = (payload: Payload, user: User, subscribed: boolean) =>
  payload.update({
    collection: 'users',
    id: user.id,
    data: { newsletter: subscribed },
    user,
    overrideAccess: false,
  })
