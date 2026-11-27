import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '@/seed'
import { MEMBERSHIP_PLANS, SEED_USERS, WORKSHOPS } from '@/seed/data'
import { PRODUCT_SEEDS } from '@/seed/ecommerce'

import { getTestPayload, type TestPayload } from '../helpers/payload'

let t: TestPayload
let payload: Payload

beforeAll(async () => {
  t = await getTestPayload()
  payload = t.payload
})

afterAll(async () => {
  await t?.cleanup()
})

const counts = async () => {
  const of = async (
    collection: 'users' | 'workshops' | 'sessions' | 'bookings' | 'media' | 'membership-plans',
  ) => (await payload.count({ collection })).totalDocs
  return {
    users: await of('users'),
    workshops: (await payload.find({ collection: 'workshops', draft: true, limit: 0 })).totalDocs,
    sessions: await of('sessions'),
    bookings: await of('bookings'),
    media: await of('media'),
    plans: await of('membership-plans'),
  }
}

describe('seed', () => {
  it('creates the demo data', async () => {
    const ctx = await seed(payload)
    const sessionCount = WORKSHOPS.reduce((n, w) => n + w.sessions.length, 0)

    expect(await counts()).toEqual({
      users: 1 + SEED_USERS.members.length,
      workshops: WORKSHOPS.length + 1, // plus one draft
      sessions: sessionCount,
      bookings: 3,
      // One per workshop and per shop product, plus hero and about art.
      media: WORKSHOPS.length + PRODUCT_SEEDS.length + 2,
      plans: MEMBERSHIP_PLANS.length,
    })
    expect(ctx.workshops.every((w) => w._status === 'published')).toBe(true)
    expect(ctx.sessions.every((s) => new Date(s.startsAt) > new Date())).toBe(true)
  })

  it('creates working logins with the documented credentials', async () => {
    const admin = await payload.login({
      collection: 'users',
      data: { email: SEED_USERS.admin.email, password: SEED_USERS.admin.password },
    })
    expect(admin.user?.role).toBe('admin')

    for (const member of SEED_USERS.members) {
      const { user } = await payload.login({
        collection: 'users',
        data: { email: member.email, password: member.password },
      })
      expect(user?.role).toBe('member')
    }
  })

  it('fills the homepage and site settings', async () => {
    const home = await payload.findGlobal({ slug: 'home' })
    expect(home.hero?.heading).toBeTruthy()
    expect(home.heroVariantB?.heading).toBeTruthy()
    expect(home.featuredWorkshops).toHaveLength(3)
    expect(home.testimonials?.length).toBeGreaterThan(0)

    const settings = await payload.findGlobal({ slug: 'site-settings' })
    expect(settings.siteName).toBe('Kiln & Co.')
  })

  it('keeps seat counts consistent with the seeded bookings', async () => {
    const { docs: bookings } = await payload.find({ collection: 'bookings', depth: 2 })
    for (const booking of bookings) {
      const session = booking.session as { seatsLeft: number; workshop: { capacity: number } }
      expect(session.seatsLeft).toBe(session.workshop.capacity - 1)
    }
  })

  it('can be re-run and resets to the same state', async () => {
    const before = await counts()
    await seed(payload)
    expect(await counts()).toEqual(before)
  })
})
