import { getMailing, processEmails, renderTemplate, sendEmail } from '@xtr-dev/payload-mailing'
import type { Payload, Where } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MAIL_QUEUES, REMINDER_LEAD_MS, setNewsletterSubscription, TEMPLATES } from '@/lib/mailing'
import { beginBookingCheckout } from '@/lib/checkout'
import { MAIL_OUTBOX_SLUG } from '@/lib/mailOutbox'
import type { Email, Session, User } from '@/payload-types'
import { seed, type SeedContext } from '@/seed'

import { getTestPayload, type TestPayload } from '../helpers/payload'

let t: TestPayload
let payload: Payload
let ctx: SeedContext
let mara: User
let jonas: User

const relId = (v: unknown) => (v && typeof v === 'object' ? (v as { id: number }).id : v)

const emailsWhere = async (where: Where) =>
  (await payload.find({ collection: 'emails', where, limit: 100, depth: 0 })).docs as Email[]

const outboxFor = async (address: string) =>
  (
    await payload.find({
      collection: MAIL_OUTBOX_SLUG,
      where: { to: { equals: address } },
      limit: 100,
      sort: '-createdAt',
    })
  ).docs

/** Drains every job queue, as the autoRun cron would (it is disabled in tests). */
const runAllJobs = () => payload.jobs.run({ allQueues: true, limit: 100 })

/** Moves an email's schedule into the past, as if its send time had arrived. */
const makeDue = (email: Email) =>
  payload.update({
    collection: 'emails',
    id: email.id,
    data: { scheduledAt: new Date(Date.now() - 1000).toISOString() },
  })

beforeAll(async () => {
  t = await getTestPayload()
  payload = t.payload
  ctx = await seed(payload)
  ;[mara, jonas] = ctx.members
})

afterAll(async () => {
  await t?.cleanup()
})

describe('wiring', () => {
  it('registers the plugin, the capture transport and the seeded templates', async () => {
    const mailing = getMailing(payload)
    expect(mailing.collections).toEqual({ emails: 'emails', templates: 'email-templates' })
    expect(payload.email.name).toBe('kiln-capture')
    const { docs } = await payload.find({ collection: 'email-templates', limit: 10 })
    expect(docs.map((d) => d.slug).sort()).toEqual(Object.values(TEMPLATES).sort())
    expect(payload.config.jobs.tasks?.some((task) => task.slug === 'process-email')).toBe(true)
  })

  it('keeps emails and templates staff-only, and members see only their own captured mail', async () => {
    await expect(
      payload.find({ collection: 'emails', user: mara, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(
      payload.find({ collection: 'email-templates', user: mara, overrideAccess: false }),
    ).rejects.toThrow()

    const own = await payload.find({
      collection: MAIL_OUTBOX_SLUG,
      user: mara,
      overrideAccess: false,
      limit: 100,
    })
    expect(own.totalDocs).toBeGreaterThan(0)
    expect(own.docs.every((d) => d.to.includes(mara.email))).toBe(true)
    const all = await payload.find({ collection: MAIL_OUTBOX_SLUG, user: ctx.admin, limit: 100 })
    expect(all.totalDocs).toBeGreaterThan(own.totalDocs)
  })
})

describe('templates', () => {
  it('renders variables, filters, conditionals and the Kiln & Co. layout', async () => {
    const vars = {
      siteUrl: 'https://kiln.example',
      preheader: 'Preheader text',
      firstName: 'Ada <script>',
      workshopTitle: 'Glazing Lab',
      instructor: 'Noor',
      sessionDate: 'Friday 4 December',
      sessionTime: '18:00',
      duration: '2 h',
      reference: 'KC-TEST1',
      amount: 65,
      paid: true,
    }
    const out = await renderTemplate(payload, TEMPLATES.bookingConfirmation, vars)

    expect(out.subject).toBe('Booked: Glazing Lab on Friday 4 December (KC-TEST1)')
    // Variables are HTML-escaped in the body, and the layout wraps it.
    expect(out.html).toContain('See you at the wheel, Ada &lt;script&gt;')
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('Kiln &amp; Co.')
    // `{{siteUrl}}` in a link URL is rendered like any other variable.
    expect(out.html).toContain('href="https://kiln.example/account"')
    expect(out.html).toContain('Price: €65.00')
    expect(out.html).toContain('Your payment is in')
    expect(out.html).not.toContain('waiting for payment')
    // The plain-text part keeps values verbatim and shows links as text.
    expect(out.text).toContain('See you at the wheel, Ada <script>')
    expect(out.text).toContain('View your booking in My studio (https://kiln.example/account)')
    expect(out.text).toContain('Manage your email settings: https://kiln.example/account#settings')

    const unpaid = await renderTemplate(payload, TEMPLATES.bookingConfirmation, {
      ...vars,
      paid: false,
    })
    expect(unpaid.html).toContain('waiting for payment')
  })

  it('formats dates in studio time and turns internal links into site URLs', async () => {
    const out = await renderTemplate(payload, TEMPLATES.newsletter, {
      siteUrl: 'https://kiln.example',
      firstName: 'Mara',
      issueDate: '2026-12-01T08:00:00.000Z',
    })
    expect(out.subject).toBe('Studio notes for 1 December 2026')
    const featured = ctx.workshops.find((w) => w.featured) ?? ctx.workshops[0]
    expect(out.html).toContain(`/workshops/${featured.slug}"`)
  })

  it('rejects a send that misses a required variable, before anything is queued', async () => {
    const before = await payload.count({ collection: 'emails' })
    await expect(
      sendEmail(payload, {
        template: { slug: TEMPLATES.welcome, variables: { siteUrl: 'x' } },
        data: { to: ['nobody@kiln.test'] },
      }),
    ).rejects.toThrow(/firstName/)
    expect((await payload.count({ collection: 'emails' })).totalDocs).toBe(before.totalDocs)
  })
})

describe('booking emails', () => {
  let session: Session
  let bookingId: number

  it('sends no confirmation while a booking waits for payment', async () => {
    const booked = new Set(
      ctx.bookings.filter((b) => relId(b.member) === jonas.id).map((b) => relId(b.session)),
    )
    const now = Date.now()
    session = ctx.sessions.find(
      (s) =>
        !booked.has(s.id) &&
        new Date(s.startsAt).getTime() - now > 2 * REMINDER_LEAD_MS &&
        (s.seatsLeft ?? 0) > 0,
    )!
    expect(session).toBeDefined()

    const booking = await payload.create({
      collection: 'bookings',
      data: { session: session.id, member: jonas.id, status: 'pending' },
      user: jonas,
      overrideAccess: false,
    })
    bookingId = booking.id
    await beginBookingCheckout({ payload, booking, user: jonas })

    expect(await emailsWhere({ booking: { equals: booking.id } })).toHaveLength(0)
  })

  it('sends a confirmation through the priority queue once the payment settles', async () => {
    const { payment } = await payload.findByID({ collection: 'bookings', id: bookingId, depth: 0 })
    expect(payment).toBeTruthy()
    // What the payment provider's callback does: billing then marks the booking paid.
    await payload.update({
      collection: 'payments',
      id: relId(payment) as number,
      data: { status: 'succeeded' },
    })
    const booking = await payload.findByID({ collection: 'bookings', id: bookingId, depth: 0 })
    expect(booking.status).toBe('paid')

    const [confirmation, ...more] = await emailsWhere({
      booking: { equals: booking.id },
      templateSlug: { equals: TEMPLATES.bookingConfirmation },
    })
    expect(more).toHaveLength(0)
    expect(confirmation).toMatchObject({ status: 'pending', to: [jonas.email], priority: 1 })
    expect(confirmation.subject).toContain(booking.reference)

    // Queued as a Payload job on the per-send queue, not the plugin's default queue.
    const jobs = await payload.find({
      collection: 'payload-jobs',
      where: { taskSlug: { equals: 'process-email' } },
      limit: 100,
    })
    const job = jobs.docs.find(
      (j) => String((j.input as { emailId?: string })?.emailId) === String(confirmation.id),
    )
    expect(job?.queue).toBe(MAIL_QUEUES.priority)

    await payload.jobs.run({ queue: MAIL_QUEUES.priority })
    const sent = await payload.findByID({ collection: 'emails', id: confirmation.id })
    expect(sent.status).toBe('sent')

    const [captured] = await outboxFor(jonas.email)
    expect(captured.subject).toBe(sent.subject)
    expect(captured.from).toBe('"Kiln & Co." <hello@kiln.test>')
    expect(captured.html).toContain(booking.reference)
    // The template's `{{siteUrl}}` links are absolute URLs on this site.
    expect(captured.html).toContain('href="http://localhost:3000/account"')
    expect(captured.text).toContain('(http://localhost:3000/account)')
  })

  it('schedules a reminder 24 hours before the session that stays queued until due', async () => {
    const [reminder] = await emailsWhere({
      booking: { equals: bookingId },
      templateSlug: { equals: TEMPLATES.classReminder },
    })
    expect(reminder.status).toBe('pending')
    expect(new Date(reminder.scheduledAt!).getTime()).toBe(
      new Date(session.startsAt).getTime() - REMINDER_LEAD_MS,
    )

    // Neither the job runner nor a manual drain sends it early.
    await runAllJobs()
    await processEmails(payload)
    expect((await payload.findByID({ collection: 'emails', id: reminder.id })).status).toBe(
      'pending',
    )

    await makeDue(reminder)
    await processEmails(payload)
    const sent = await payload.findByID({ collection: 'emails', id: reminder.id })
    expect(sent.status).toBe('sent')
    expect((await outboxFor(jonas.email))[0].subject).toMatch(/^Tomorrow: /)
  })

  it('withdraws a pending reminder when the booking is cancelled', async () => {
    const reminders = await emailsWhere({
      templateSlug: { equals: TEMPLATES.classReminder },
      status: { equals: 'pending' },
    })
    const bookingWithReminder = relId(reminders[0]?.booking) as number
    expect(bookingWithReminder).toBeDefined()

    await payload.update({
      collection: 'bookings',
      id: bookingWithReminder,
      data: { status: 'cancelled' },
    })
    const pending = await emailsWhere({
      booking: { equals: bookingWithReminder },
      status: { equals: 'pending' },
    })
    expect(pending).toHaveLength(0)
  })
})

describe('newsletter', () => {
  const newsletterFor = (user: User) =>
    emailsWhere({
      recipient: { equals: user.id },
      templateSlug: { equals: TEMPLATES.newsletter },
    })

  it('schedules the seeded issue for subscribers only', async () => {
    const [issue] = await newsletterFor(mara)
    expect(issue.status).toBe('pending')
    expect(new Date(issue.scheduledAt!).getTime()).toBeGreaterThan(Date.now())
    expect(await newsletterFor(jonas)).toHaveLength(0)
  })

  it('adds a member who opts in to the upcoming issue and confirms right away', async () => {
    const [maraIssue] = await newsletterFor(mara)
    await setNewsletterSubscription(payload, jonas, true)

    const [issue] = await newsletterFor(jonas)
    expect(issue.scheduledAt).toBe(maraIssue.scheduledAt)
    // `processImmediately`: the confirmation is captured without running the job queue, although
    // it is queued on the plugin's `mail` queue rather than Payload's `default` one.
    const [latest] = await outboxFor(jonas.email)
    expect(latest.subject).toBe('You’re on the list, Jonas')
    expect(latest.html).toContain('The next issue goes out on')
    const [subscribed] = await emailsWhere({
      recipient: { equals: jonas.id },
      templateSlug: { equals: TEMPLATES.newsletterSubscribed },
    })
    expect(subscribed.status).toBe('sent')
  })

  it('respects an opt-out: the scheduled issue is never delivered', async () => {
    await setNewsletterSubscription(payload, mara, false)
    expect(await newsletterFor(mara)).toHaveLength(0)

    const [jonasIssue] = await newsletterFor(jonas)
    await makeDue(jonasIssue)
    await processEmails(payload)

    const newsletterMail = (await outboxFor(mara.email)).filter((m) =>
      m.subject.startsWith('Studio notes'),
    )
    expect(newsletterMail).toHaveLength(0)
    const [delivered] = (await outboxFor(jonas.email)).filter((m) =>
      m.subject.startsWith('Studio notes'),
    )
    expect(delivered).toBeDefined()
    expect((delivered.headers as Record<string, string>)['List-Unsubscribe']).toContain(
      '/account#settings',
    )
  })
})

describe('welcome email', () => {
  it('is queued when someone registers and delivered by the mail queue', async () => {
    const user = await payload.create({
      collection: 'users',
      // `role` is admin-only, so it falls back to `member` for this public sign-up.
      data: { name: 'Noor Jansen', email: 'noor@kiln.test', password: 'pw-123456', role: 'member' },
      overrideAccess: false,
    })
    const [welcome] = await emailsWhere({
      recipient: { equals: user.id },
      templateSlug: { equals: TEMPLATES.welcome },
    })
    expect(welcome).toMatchObject({ status: 'pending', subject: 'Welcome to Kiln & Co., Noor' })

    await payload.jobs.run({ queue: MAIL_QUEUES.default })
    const [captured] = await outboxFor(user.email)
    expect(captured.subject).toBe('Welcome to Kiln & Co., Noor')
  })
})
