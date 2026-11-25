import type { File, Payload } from 'payload'

import { slugify } from '@/hooks/slugify'
import { richText } from '@/lib/richtext'
import type { Booking, Media, Session, Workshop } from '@/payload-types'

import { shelvesArt, vesselArt, type VesselArtOptions } from './art'
import { MEMBERSHIP_PLANS, PALETTE, SEED_USERS, TESTIMONIALS, WORKSHOPS } from './data'
import type { SeedContext } from './types'

/** Site collections owned by the core seed, in an order that is safe to delete. */
export const CORE_COLLECTIONS = [
  'bookings',
  'sessions',
  'workshops',
  'membership-plans',
  'media',
  'users',
] as const

const svgFile = (name: string, svg: string): File => {
  const data = Buffer.from(svg, 'utf8')
  return { name, data, mimetype: 'image/svg+xml', size: data.byteLength }
}

const uploadSvg = (payload: Payload, name: string, alt: string, svg: string): Promise<Media> =>
  payload.create({ collection: 'media', data: { alt }, file: svgFile(name, svg) })

/** Removes every document from the core collections. */
export const resetCore = async (payload: Payload): Promise<void> => {
  for (const collection of CORE_COLLECTIONS) {
    await payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true })
  }
}

const atDaysFromNow = (inDays: number, hourUtc: number): string => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + inDays)
  date.setUTCHours(hourUtc, 0, 0, 0)
  return date.toISOString()
}

export const seedCore = async (payload: Payload): Promise<SeedContext> => {
  const admin = await payload.create({ collection: 'users', data: { ...SEED_USERS.admin } })

  const plans = []
  for (const plan of MEMBERSHIP_PLANS) {
    plans.push(
      await payload.create({
        collection: 'membership-plans',
        data: { ...plan, perks: plan.perks.map((perk) => ({ perk })) },
      }),
    )
  }

  const renewsAt = new Date()
  renewsAt.setUTCMonth(renewsAt.getUTCMonth() + 1)
  const members = []
  for (const [i, member] of SEED_USERS.members.entries()) {
    members.push(
      await payload.create({
        collection: 'users',
        data: {
          ...member,
          // The first member has an active membership so the account area has something to show.
          ...(i === 0
            ? {
                membershipPlan: plans[1].id,
                membershipStatus: 'active' as const,
                membershipRenewsAt: renewsAt.toISOString(),
              }
            : {}),
        },
      }),
    )
  }

  const workshops: Workshop[] = []
  const sessions: Session[] = []
  const sessionsByWorkshop: Session[][] = []
  for (const w of WORKSHOPS) {
    const image = await uploadSvg(
      payload,
      `${w.art.shape}-${workshops.length + 1}.svg`,
      `Illustration of a ${w.art.shape} glazed for ${w.title}`,
      vesselArt(w.art),
    )
    const workshop = await payload.create({
      collection: 'workshops',
      data: {
        title: w.title,
        slug: slugify(w.title),
        summary: w.summary,
        description: richText(...w.description, { h: 'What’s included' }, { ul: w.bullets }),
        price: w.price,
        capacity: w.capacity,
        format: w.format,
        level: w.level,
        duration: w.duration,
        weeks: w.weeks,
        instructor: w.instructor,
        featured: w.featured,
        images: [image.id],
        _status: 'published',
      },
    })
    workshops.push(workshop)
    const own: Session[] = []
    for (const s of w.sessions) {
      own.push(
        await payload.create({
          collection: 'sessions',
          depth: 0,
          data: {
            workshop: workshop.id,
            startsAt: atDaysFromNow(s.inDays, s.hourUtc),
            status: 'scheduled',
          },
        }),
      )
    }
    sessions.push(...own)
    sessionsByWorkshop.push(own)
  }

  // One unpublished draft, to demonstrate that the public only sees published workshops.
  await payload.create({
    collection: 'workshops',
    draft: true,
    data: {
      title: 'Raku Firing Weekend (draft)',
      slug: 'raku-firing-weekend',
      summary: 'Not announced yet: a weekend of raku firing on the beach.',
      price: 18500,
      capacity: 6,
      format: 'one-off',
      level: 'advanced',
      duration: 480,
      _status: 'draft',
    },
  })

  const sessionOf = (workshopIndex: number, n = 0) => sessionsByWorkshop[workshopIndex][n]

  const bookings: Booking[] = []
  const bookingSeeds: Array<{ member: number; session: Session; status: Booking['status'] }> = [
    { member: 0, session: sessionOf(0), status: 'paid' },
    { member: 0, session: sessionOf(3), status: 'pending' },
    { member: 1, session: sessionOf(2), status: 'paid' },
  ]
  for (const b of bookingSeeds) {
    bookings.push(
      await payload.create({
        collection: 'bookings',
        data: { member: members[b.member].id, session: b.session.id, status: b.status },
      }),
    )
  }

  const heroPots: VesselArtOptions[] = [
    { shape: 'vase', bg: '', sun: '', body: PALETTE.terracotta, glaze: PALETTE.glaze, dip: 0.55 },
    { shape: 'jar', bg: '', sun: '', body: '#b77a55', glaze: PALETTE.ochre, dip: 0.5 },
    { shape: 'tumbler', bg: '', sun: '', body: '#c2a68a', glaze: PALETTE.cobalt, dip: 0.68 },
  ]
  const heroImage = await uploadSvg(
    payload,
    'studio-shelves.svg',
    'Glazed pots drying on two studio shelves: a green vase, an ochre jar, a blue tumbler and a white mug',
    shelvesArt({
      bg: PALETTE.bisque,
      shelf: '#8a5a3c',
      top: [heroPots[0], heroPots[1]],
      bottom: [
        heroPots[2],
        { shape: 'mug', bg: '', sun: '', body: '#a0583d', glaze: '#efe9df', dip: 0.66 },
      ],
    }),
  )
  const aboutImage = await uploadSvg(
    payload,
    'about-bowl.svg',
    'A celadon-glazed bowl drying on a warm background',
    vesselArt({
      shape: 'bowl',
      bg: '#e9dccb',
      sun: PALETTE.sand,
      body: '#9c5a3c',
      glaze: PALETTE.celadon,
    }),
  )

  await payload.updateGlobal({
    slug: 'home',
    data: {
      hero: {
        eyebrow: 'Ceramics studio · Zandvoort aan Zee',
        heading: 'Get your hands in the clay.',
        subheading:
          'Small, unhurried pottery classes in a sunny studio two streets from the sea. Come for an evening, stay for a six-week course, or make the studio yours as a member.',
        ctaLabel: 'Find a workshop',
        ctaHref: '/workshops',
        image: heroImage.id,
      },
      heroVariantB: {
        eyebrow: 'New to pottery?',
        heading: 'Your first bowl is one evening away.',
        subheading:
          'No experience needed. We provide the clay, the wheel and the patience — you bring curiosity. Seats are limited to eight per class.',
        ctaLabel: 'Book a beginner class',
        ctaHref: `/workshops/${workshops[0].slug}`,
      },
      featuredHeading: 'Start here',
      featuredWorkshops: workshops.filter((w) => w.featured).map((w) => w.id),
      about: {
        heading: 'A small studio with a big kiln',
        body: richText(
          'Kiln & Co. started in 2019 in a former boat shed. Today it is a working studio with eight wheels, a glaze kitchen and two electric kilns, run by potters Ilse and Noor.',
          'We keep classes small so there is time for everyone, and we fire everything you make in our own kilns. Members use the studio during opening hours and help shape what we teach next.',
        ),
        image: aboutImage.id,
      },
      testimonials: TESTIMONIALS,
    },
  })

  await payload.updateGlobal({
    slug: 'site-settings',
    data: {
      siteName: 'Kiln & Co.',
      tagline: 'Pottery workshops & studio membership by the sea',
      announcement: 'New: the Six-Week Wheel Course starts again next week — four seats left.',
      contact: {
        email: 'hello@kiln.test',
        phone: '+31 23 000 0000',
        address: 'Strandweg 12\n2042 AA Zandvoort aan Zee',
      },
      openingHours: [
        { days: 'Tue – Fri', hours: '10:00 – 22:00' },
        { days: 'Sat – Sun', hours: '10:00 – 17:00' },
        { days: 'Mon', hours: 'Closed (kiln day)' },
      ],
      social: [
        { label: 'Instagram', url: 'https://instagram.com/' },
        { label: 'Newsletter', url: '/showcase#mailing' },
      ],
    },
  })

  return { admin, members, workshops, sessions, bookings, plans }
}
