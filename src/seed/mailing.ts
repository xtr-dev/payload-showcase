import type { Payload } from 'payload'

import {
  scheduleClassReminder,
  scheduleNewsletter,
  sendBookingConfirmation,
  sendWelcomeEmail,
  siteUrl,
  TEMPLATES,
} from '@/lib/mailing'
import { MAIL_OUTBOX_SLUG } from '@/lib/mailOutbox'
import type { EmailTemplate, Workshop } from '@/payload-types'

import type { SeedContext } from './types'

/*
 * Lexical builders for email templates. Unlike src/lib/richtext.ts they support inline bold
 * text and links, which the templates need. `{{ }}` and `{% %}` inside text are LiquidJS tags
 * that payload-mailing renders at send time.
 *
 * Custom links start with `{{siteUrl}}`, so emails link to absolute URLs on this site. Lexical
 * stores such a URL percent-encoded; payload-mailing decodes it before rendering. Keep the braces
 * free of spaces, since Lexical's link validation rejects them.
 */
type Inline =
  string | { b: string } | { a: string; href: string } | { a: string; workshop: Workshop }
type Block = Inline | Inline[] | { h: string } | { ul: Inline[] } | { quote: string }

const base = { format: '' as const, indent: 0, version: 1, direction: 'ltr' as const }

const textNode = (text: string, format = 0) => ({
  type: 'text',
  text,
  format,
  style: '',
  mode: 'normal',
  detail: 0,
  version: 1,
})

const inline = (item: Inline) => {
  if (typeof item === 'string') return textNode(item)
  if ('b' in item) return textNode(item.b, 1)
  const fields =
    'href' in item
      ? { linkType: 'custom', url: item.href, newTab: false }
      : {
          linkType: 'internal',
          doc: { relationTo: 'workshops', value: item.workshop.id },
          newTab: false,
        }
  return { ...base, type: 'link', fields, children: [textNode(item.a)] }
}

const block = (b: Block) => {
  if (typeof b === 'object' && !Array.isArray(b)) {
    if ('h' in b) return { ...base, type: 'heading', tag: 'h2', children: [textNode(b.h)] }
    if ('ul' in b) {
      return {
        ...base,
        type: 'list',
        listType: 'bullet',
        tag: 'ul',
        start: 1,
        children: b.ul.map((item, i) => ({
          ...base,
          type: 'listitem',
          value: i + 1,
          children: [inline(item)],
        })),
      }
    }
    if ('quote' in b) return { ...base, type: 'quote', children: [textNode(b.quote)] }
  }
  const parts = Array.isArray(b) ? b : [b]
  return { ...base, type: 'paragraph', textFormat: 0, textStyle: '', children: parts.map(inline) }
}

const doc = (...blocks: Block[]): EmailTemplate['content'] => ({
  root: { ...base, type: 'root', children: blocks.map(block) },
})

const required = (...names: string[]) => names.map((name) => ({ name, required: true }))

const sampleBooking = {
  siteUrl: 'http://localhost:3000',
  preheader: 'Your seat in Wheel Throwing for Beginners is confirmed.',
  firstName: 'Mara',
  workshopTitle: 'Wheel Throwing for Beginners',
  instructor: 'Ilse Bakker',
  startsAt: '2026-12-04T17:00:00.000Z',
  sessionDate: 'Friday 4 December',
  sessionTime: '18:00',
  duration: '2 h 30 min',
  reference: 'KC-DEMO42',
  amount: 65,
  paid: true,
}

/** The six templates. Editors can change all of them under Mailing → Email Templates. */
const templates = (featured: Workshop | undefined) => [
  {
    name: 'Booking confirmation',
    slug: TEMPLATES.bookingConfirmation,
    subject: 'Booked: {{ workshopTitle }} on {{ sessionDate }} ({{ reference }})',
    content: doc(
      { h: 'See you at the wheel, {{ firstName }}' },
      ['Thanks for booking ', { b: '{{ workshopTitle }}' }, '. Your seat is confirmed.'],
      {
        ul: [
          'When: {{ sessionDate }} at {{ sessionTime }} ({{ duration }})',
          'Teacher: {{ instructor }}',
          'Price: {{ amount | formatCurrency }}',
          'Booking reference: {{ reference }}',
        ],
      },
      '{% if paid %}Your payment is in, so there is nothing left to do.{% else %}Your booking is waiting for payment. You can pay from My studio.{% endif %}',
      [{ a: 'View your booking in My studio', href: '{{siteUrl}}/account' }],
      'Wear clothes that can take a little clay. Aprons, tools and tea are on us.',
    ),
    variables: required('firstName', 'workshopTitle', 'sessionDate', 'sessionTime', 'reference'),
    sampleVariables: sampleBooking,
  },
  {
    name: 'Class reminder (24 hours before)',
    slug: TEMPLATES.classReminder,
    subject: 'Tomorrow: {{ workshopTitle }} at {{ sessionTime }}',
    content: doc(
      { h: 'Tomorrow is clay day, {{ firstName }}' },
      [
        'A friendly reminder that ',
        { b: '{{ workshopTitle }}' },
        ' starts tomorrow, {{ sessionDate }}, at {{ sessionTime }}.',
      ],
      {
        ul: [
          'Arrive ten minutes early for tea and an apron',
          'Short nails and clothes you can get muddy',
          'Booking reference: {{ reference }}',
        ],
      },
      {
        quote:
          'Can’t make it after all? Let us know, and we’ll offer your seat to the waiting list.',
      },
      [{ a: 'See your booking', href: '{{siteUrl}}/account' }],
    ),
    variables: required('firstName', 'workshopTitle', 'sessionDate', 'sessionTime'),
    sampleVariables: { ...sampleBooking, preheader: 'See you tomorrow at Wheel Throwing.' },
  },
  {
    name: 'Welcome email',
    slug: TEMPLATES.welcome,
    subject: 'Welcome to Kiln & Co., {{ firstName }}',
    content: doc(
      { h: 'Welcome to the studio, {{ firstName }}' },
      'We are a small ceramics studio by the sea, and we are glad you found us. Here is how most people start:',
      {
        ul: [
          'Book a one-off evening class to feel the clay for the first time',
          'Join a course to learn throwing, trimming and glazing properly',
          'Become a member for open-studio time, clay and firings',
        ],
      },
      [
        { a: 'Browse workshops', href: '{{siteUrl}}/workshops' },
        ' or ',
        { a: 'see membership plans', href: '{{siteUrl}}/membership' },
        '.',
      ],
    ),
    variables: required('firstName'),
    sampleVariables: {
      siteUrl: 'http://localhost:3000',
      preheader: 'Welcome to the studio.',
      firstName: 'Mara',
    },
  },
  {
    name: 'Studio newsletter',
    slug: TEMPLATES.newsletter,
    subject: 'Studio notes for {{ issueDate | formatDate: "long" }}',
    content: doc(
      { h: 'Studio notes, {{ firstName }}' },
      'Winter is our favourite season in the studio: the kiln keeps the room warm and the light off the sea is soft and low.',
      { h: 'New on the glaze shelf' },
      'We mixed two new house glazes this month: a deep celadon called Breakwater and a speckled oatmeal called Dune. Members can test them on any bisque piece.',
      { h: 'Classes with seats left' },
      featured
        ? [
            'Our most-loved evening class still has seats: ',
            { a: featured.title, workshop: featured },
            '.',
          ]
        : 'Several evening classes still have seats this month.',
      [{ a: 'See all workshops', href: '{{siteUrl}}/workshops' }],
      { quote: 'Open studio is now also on Sunday mornings, 10:00 to 13:00.' },
      [
        'You get this newsletter because you subscribed in My studio. ',
        { a: 'Unsubscribe or change settings', href: '{{siteUrl}}/account#settings' },
        '.',
      ],
    ),
    variables: required('firstName', 'issueDate'),
    sampleVariables: {
      siteUrl: 'http://localhost:3000',
      preheader: 'News from the studio.',
      firstName: 'Mara',
      issueDate: '2026-12-01T08:00:00.000Z',
    },
  },
  {
    name: 'Newsletter subscription confirmed',
    slug: TEMPLATES.newsletterSubscribed,
    subject: 'You’re on the list, {{ firstName }}',
    content: doc(
      { h: 'You’re on the list' },
      'Thanks, {{ firstName }}. Once a month we’ll send you studio notes: new classes, glazes and open-studio hours.',
      '{% if nextIssue != "" %}The next issue goes out on {{ nextIssue | formatDate: "long" }}.{% endif %}',
      [{ a: 'Change your email settings', href: '{{siteUrl}}/account#settings' }],
    ),
    variables: required('firstName'),
    sampleVariables: {
      siteUrl: 'http://localhost:3000',
      preheader: 'You are on the list.',
      firstName: 'Mara',
      nextIssue: '2026-12-01T08:00:00.000Z',
    },
  },
  {
    // Sent by sendOrderConfirmation (src/lib/shop.ts) when a shop order is paid. Amounts are in
    // euros; the link carries the order's token, so a guest can open their order from the email.
    name: 'Shop order confirmation',
    slug: TEMPLATES.orderConfirmation,
    subject: 'Your Kiln & Co. order {{ orderNumber }}',
    content: doc(
      { h: 'Thank you, {{ firstName }}' },
      ['Your order ', { b: '{{ orderNumber }}' }, ' is paid, and we are wrapping it now.'],
      {
        ul: [
          'Items: {{ items }}',
          'Shipping: {% if shipping > 0 %}{{ shipping | formatCurrency }}{% else %}free{% endif %}',
          'Total: {{ total | formatCurrency }} including 21% VAT{% if discount > 0 %}, after {{ discount | formatCurrency }} discount{% endif %}',
          'Ships to: {{ shipTo }}',
        ],
      },
      [
        {
          a: 'Follow your order',
          href: '{{siteUrl}}/shop/orders/{{orderNumber}}?t={{orderToken}}',
        },
      ],
      'Every piece is wrapped by hand and posted within three working days.',
    ),
    variables: required('firstName', 'orderNumber', 'items', 'total', 'orderToken'),
    sampleVariables: {
      siteUrl: 'http://localhost:3000',
      preheader: 'Your order is paid and on its way to the packing table.',
      firstName: 'Mara',
      orderNumber: 'ORD-1764000000000-042',
      orderToken: '0000000000000000000000000000000000000000',
      items: '2 × Speckled mug (Celadon), 1 × Breakfast bowl',
      shipping: 0,
      discount: 9,
      total: 81,
      shipTo: 'Mara de Vries, Strandweg 12, 2042 AA Zandvoort',
    },
  },
]

/** 09:00 studio time (08:00 UTC in winter) on the first day of next month. */
export const nextNewsletterDate = (now = new Date()): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 8, 0, 0))

/**
 * Seeds the mailing integration: the six templates, a welcome email for each member and a
 * confirmation for each paid seeded booking (sent immediately, so the outbox has something to show),
 * class reminders scheduled 24 hours before each session, and next month's newsletter scheduled
 * for the subscribers (Mara subscribes, Jonas doesn't).
 */
export const seedMailing = async (
  payload: Payload,
  ctx: SeedContext,
  { reset }: { reset: boolean },
): Promise<void> => {
  if (reset) {
    for (const collection of [MAIL_OUTBOX_SLUG, 'emails', 'email-templates'] as const) {
      await payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true })
    }
    await payload.delete({
      collection: 'payload-jobs',
      where: { taskSlug: { equals: 'process-email' } },
      overrideAccess: true,
    })
  }

  const featured = ctx.workshops.find((w) => w.featured) ?? ctx.workshops[0]
  for (const template of templates(featured)) {
    await payload.create({ collection: 'email-templates', data: template, overrideAccess: true })
  }

  const [mara] = ctx.members
  if (mara) {
    // skipMail: the subscription confirmation is a member action, not part of the demo data.
    await payload.update({
      collection: 'users',
      id: mara.id,
      data: { newsletter: true },
      context: { skipMail: true },
    })
  }

  for (const member of ctx.members) {
    await sendWelcomeEmail(payload, member, { processImmediately: true })
  }
  // Only paid bookings are confirmed. Statuses are read fresh: the billing seed runs first.
  const { docs: paid } = await payload.find({
    collection: 'bookings',
    where: {
      id: { in: ctx.bookings.map((b) => b.id) },
      status: { equals: 'paid' },
    },
    depth: 0,
    limit: 0,
    overrideAccess: true,
  })
  for (const booking of paid) {
    await sendBookingConfirmation(payload, booking, { processImmediately: true })
    await scheduleClassReminder(payload, booking)
  }
  await scheduleNewsletter(payload, nextNewsletterDate())
  payload.logger.info(`Mailing seeded (links point at ${siteUrl()}).`)
}
