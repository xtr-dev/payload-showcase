import type { VesselArtOptions } from './art'

/**
 * Seeded logins. Development and demo use only: `pnpm seed` refuses to run in production.
 */
export const SEED_USERS = {
  admin: { name: 'Ilse Bakker', email: 'admin@kiln.test', password: 'kiln-admin', role: 'admin' },
  members: [
    { name: 'Mara Visser', email: 'mara@kiln.test', password: 'kiln-member', role: 'member' },
    { name: 'Jonas de Wit', email: 'jonas@kiln.test', password: 'kiln-member', role: 'member' },
  ],
} as const

export const PALETTE = {
  paper: '#f6efe4',
  bisque: '#ead9c2',
  sand: '#dcc3a1',
  clay: '#b4532a',
  terracotta: '#c8693f',
  umber: '#3a2a20',
  celadon: '#9fbfb0',
  glaze: '#2f5d57',
  ochre: '#d9a441',
  cobalt: '#2c4a7a',
  ash: '#d7d2c8',
}

export interface SeedWorkshop {
  title: string
  summary: string
  description: string[]
  bullets: string[]
  price: number
  capacity: number
  format: 'one-off' | 'course'
  level: 'beginner' | 'intermediate' | 'advanced' | 'all'
  duration: number
  weeks?: number
  instructor: string
  featured: boolean
  art: VesselArtOptions
  /** Days from today of each upcoming session, and the start hour in UTC. */
  sessions: Array<{ inDays: number; hourUtc: number }>
}

export const WORKSHOPS: SeedWorkshop[] = [
  {
    title: 'Wheel Throwing for Beginners',
    summary:
      'Your first evening at the wheel: centre the clay, open it up and pull the walls of a small bowl you can glaze later.',
    description: [
      'Everyone remembers the first time clay stays centred under their hands. In this relaxed evening class we take you from a lump of stoneware to a bowl or two, at your own pace.',
      'We fire your best piece and glaze it in one of our house glazes, ready for collection about three weeks later.',
    ],
    bullets: [
      'All clay, tools and aprons provided',
      'One piece fired and glazed',
      'Tea, coffee and biscuits',
    ],
    price: 6500,
    capacity: 8,
    format: 'one-off',
    level: 'beginner',
    duration: 150,
    instructor: 'Ilse Bakker',
    featured: true,
    art: {
      shape: 'bowl',
      bg: PALETTE.bisque,
      sun: '#e3c9a8',
      body: PALETTE.terracotta,
      glaze: PALETTE.glaze,
      dip: 0.55,
    },
    sessions: [
      { inDays: 3, hourUtc: 17 },
      { inDays: 10, hourUtc: 17 },
      { inDays: 17, hourUtc: 17 },
    ],
  },
  {
    title: 'Six-Week Wheel Course',
    summary:
      'Six Tuesday evenings that build real skill: cylinders, bowls, trimming, handles and glazing a small set of your own.',
    description: [
      'This is our most popular course and the best way to get properly hooked. Each week builds on the last, and you get open studio time between sessions to practise.',
      'By the end you will have thrown, trimmed and glazed a small set of pieces, and you will know your way around the studio well enough to carry on as a member.',
    ],
    bullets: [
      'Six 2.5-hour sessions',
      'Clay and up to eight firings included',
      'Two open-studio sessions included',
    ],
    price: 34500,
    capacity: 8,
    format: 'course',
    weeks: 6,
    level: 'beginner',
    duration: 150,
    instructor: 'Ilse Bakker',
    featured: true,
    art: {
      shape: 'vase',
      bg: '#e6d3c0',
      sun: '#d7b996',
      body: '#a8553a',
      glaze: PALETTE.celadon,
      dip: 0.6,
    },
    sessions: [
      { inDays: 6, hourUtc: 17 },
      { inDays: 34, hourUtc: 17 },
    ],
  },
  {
    title: 'Hand-Building: Pinch, Coil & Slab',
    summary:
      'No wheel needed. Build a textured planter and a little pinch pot with the oldest techniques in pottery.',
    description: [
      'Hand-building is slow, forgiving and deeply satisfying. You will learn to pinch, coil and join slabs, and to add texture with found objects from the beach outside.',
    ],
    bullets: [
      'Great for families and groups',
      'Two pieces fired and glazed',
      'Suitable from age 12',
    ],
    price: 5500,
    capacity: 10,
    format: 'one-off',
    level: 'all',
    duration: 180,
    instructor: 'Noor Hendriks',
    featured: true,
    art: {
      shape: 'jar',
      bg: '#dfe5dc',
      sun: '#c8d6c8',
      body: '#b77a55',
      glaze: PALETTE.ochre,
      dip: 0.5,
    },
    sessions: [
      { inDays: 4, hourUtc: 9 },
      { inDays: 11, hourUtc: 9 },
      { inDays: 25, hourUtc: 9 },
    ],
  },
  {
    title: 'Glaze Lab',
    summary:
      'Mix, layer and test glazes. Leave with a tile board of your own recipes and a clearer idea of what happens in the kiln.',
    description: [
      'Glaze is where the magic and the frustration live. In this afternoon session we demystify it: base recipes, oxides, layering and how firing temperature changes everything.',
    ],
    bullets: [
      'Bring your own bisque pieces, or use ours',
      'Twelve test tiles fired for you',
      'Printed recipe notes',
    ],
    price: 7500,
    capacity: 6,
    format: 'one-off',
    level: 'intermediate',
    duration: 180,
    instructor: 'Noor Hendriks',
    featured: false,
    art: {
      shape: 'tumbler',
      bg: '#e9e1d3',
      sun: '#d9cbb3',
      body: '#c2a68a',
      glaze: PALETTE.cobalt,
      dip: 0.7,
    },
    sessions: [
      { inDays: 8, hourUtc: 13 },
      { inDays: 29, hourUtc: 13 },
    ],
  },
  {
    title: 'Mugs & Handles',
    summary:
      'Throw a pair of mugs and learn to pull and attach handles that feel good in the hand.',
    description: [
      'A good mug is harder than it looks. We focus on even walls, a comfortable lip and a handle that is strong, balanced and attached for life.',
    ],
    bullets: [
      'Wheel experience required',
      'Two mugs fired and glazed',
      'Includes a trimming session the week after',
    ],
    price: 9500,
    capacity: 6,
    format: 'one-off',
    level: 'intermediate',
    duration: 180,
    instructor: 'Ilse Bakker',
    featured: false,
    art: {
      shape: 'mug',
      bg: '#f0e2cf',
      sun: '#e2c79f',
      body: '#a0583d',
      glaze: '#e9e4da',
      dip: 0.66,
    },
    sessions: [
      { inDays: 12, hourUtc: 9 },
      { inDays: 40, hourUtc: 9 },
    ],
  },
  {
    title: 'Advanced Throwing: Large Forms',
    summary:
      'A four-week course for confident throwers: tall cylinders, big bowls and throwing in sections.',
    description: [
      'For members and returning students who want to scale up. We work with larger weights of clay, ribs and throwing bats, and look at assembling forms from several thrown sections.',
    ],
    bullets: [
      'Four 3-hour sessions',
      'Up to 10 kg of clay per session',
      'Small group, lots of individual feedback',
    ],
    price: 29500,
    capacity: 5,
    format: 'course',
    weeks: 4,
    level: 'advanced',
    duration: 180,
    instructor: 'Ilse Bakker',
    featured: false,
    art: {
      shape: 'plate',
      bg: '#e2dbd0',
      sun: '#cfc3b0',
      body: '#8f4f36',
      glaze: '#6f8f7d',
      dip: 0.45,
    },
    sessions: [{ inDays: 20, hourUtc: 17 }],
  },
]

export const MEMBERSHIP_PLANS = [
  {
    name: 'Open Studio',
    slug: 'open-studio',
    tagline: 'For finding your rhythm',
    price: 4900,
    highlighted: false,
    perks: [
      '8 hours of open studio a month',
      'Shelf space for work in progress',
      '10% off workshops',
    ],
  },
  {
    name: 'Studio Member',
    slug: 'studio-member',
    tagline: 'Our most popular plan',
    price: 8900,
    highlighted: true,
    perks: [
      'Unlimited open studio during opening hours',
      '10 kg of clay and firings included each month',
      '15% off workshops and early booking',
    ],
  },
  {
    name: 'Resident Maker',
    slug: 'resident-maker',
    tagline: 'For serious production',
    price: 16500,
    highlighted: false,
    perks: [
      '24/7 key access and a dedicated wheel',
      'Your own shelving bay',
      'Sell your work in the studio shop',
    ],
  },
]

export const TESTIMONIALS = [
  {
    quote:
      'I came for one evening and left with a wonky bowl and a new obsession. Six months on I am a member and I still look forward to every Tuesday.',
    name: 'Femke',
    detail: 'Studio member since spring',
  },
  {
    quote:
      'The kindest, calmest teachers. They make you feel like the clay collapsing is part of the fun, which it is.',
    name: 'Daan',
    detail: 'Six-Week Wheel Course',
  },
  {
    quote:
      'We booked hand-building for my daughter’s birthday. Everyone went home with something they were proud of.',
    name: 'Sanne',
    detail: 'Hand-Building class',
  },
]
