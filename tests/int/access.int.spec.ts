import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { User } from '@/payload-types'
import { seed, type SeedContext } from '@/seed'

import { getTestPayload, type TestPayload } from '../helpers/payload'

let t: TestPayload
let payload: Payload
let ctx: SeedContext
let mara: User
let jonas: User

const relId = (v: unknown) => (v && typeof v === 'object' ? (v as { id: number }).id : v)

beforeAll(async () => {
  t = await getTestPayload()
  payload = t.payload
  ctx = await seed(payload)
  ;[mara, jonas] = ctx.members
})

afterAll(async () => {
  await t?.cleanup()
})

describe('workshops and sessions (public)', () => {
  it('lets the public read published workshops but not drafts', async () => {
    const { docs } = await payload.find({
      collection: 'workshops',
      overrideAccess: false,
      limit: 100,
    })
    expect(docs).toHaveLength(ctx.workshops.length)
    expect(docs.every((w) => w._status === 'published')).toBe(true)

    const all = await payload.find({ collection: 'workshops', draft: true, limit: 100 })
    expect(all.totalDocs).toBe(ctx.workshops.length + 1)
  })

  it('lets the public read sessions of published workshops only', async () => {
    const draft = await payload.find({
      collection: 'workshops',
      where: { _status: { equals: 'draft' } },
      draft: true,
      limit: 1,
    })
    const hidden = await payload.create({
      collection: 'sessions',
      data: {
        workshop: draft.docs[0].id,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        status: 'scheduled',
      },
    })

    const { docs } = await payload.find({
      collection: 'sessions',
      overrideAccess: false,
      limit: 100,
    })
    expect(docs.length).toBe(ctx.sessions.length)
    expect(docs.map((s) => s.id)).not.toContain(hidden.id)
  })

  it('does not let members create or edit workshops', async () => {
    await expect(
      payload.create({
        collection: 'workshops',
        data: {
          title: 'Sneaky',
          slug: 'sneaky',
          summary: 'x',
          price: 1,
          capacity: 1,
          format: 'one-off',
          level: 'beginner',
          duration: 60,
        },
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'workshops',
        id: ctx.workshops[0].id,
        data: { price: 1 },
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})

describe('bookings', () => {
  it('hides all bookings from the public', async () => {
    await expect(payload.find({ collection: 'bookings', overrideAccess: false })).rejects.toThrow()
  })

  it('shows members only their own bookings', async () => {
    const own = await payload.find({ collection: 'bookings', user: mara, overrideAccess: false })
    expect(own.totalDocs).toBe(2)
    expect(own.docs.every((b) => relId(b.member) === mara.id)).toBe(true)

    const jonasBooking = ctx.bookings.find((b) => relId(b.member) === jonas.id)!
    await expect(
      payload.findByID({
        collection: 'bookings',
        id: jonasBooking.id,
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('lets admins see every booking', async () => {
    const all = await payload.find({
      collection: 'bookings',
      user: ctx.admin,
      overrideAccess: false,
    })
    expect(all.totalDocs).toBe(ctx.bookings.length)
  })

  it('forces member, status and price when a member books', async () => {
    const session = ctx.sessions[ctx.sessions.length - 1]
    const before = await payload.findByID({ collection: 'sessions', id: session.id })
    const workshop = ctx.workshops.find((w) => w.id === relId(session.workshop))!

    const booking = await payload.create({
      collection: 'bookings',
      // A member tries to book for someone else, for free, already paid.
      data: { session: session.id, member: mara.id, status: 'paid', amount: 0 },
      user: jonas,
      overrideAccess: false,
    })
    expect(relId(booking.member)).toBe(jonas.id)
    expect(booking.status).toBe('pending')
    expect(booking.amount).toBe(workshop.price)
    expect(booking.reference).toMatch(/^KC-/)

    const after = await payload.findByID({ collection: 'sessions', id: session.id })
    expect(after.seatsLeft).toBe((before.seatsLeft ?? 0) - 1)

    await expect(
      payload.create({
        collection: 'bookings',
        data: { session: session.id, status: 'pending' },
        user: jonas,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/already have a seat/)

    // Members cannot change their booking; cancelling (admin or billing) releases the seat.
    await expect(
      payload.update({
        collection: 'bookings',
        id: booking.id,
        data: { status: 'paid' },
        user: jonas,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await payload.update({ collection: 'bookings', id: booking.id, data: { status: 'cancelled' } })
    const released = await payload.findByID({ collection: 'sessions', id: session.id })
    expect(released.seatsLeft).toBe(before.seatsLeft)
  })

  it('rejects bookings when a session is full', async () => {
    const session = ctx.sessions[0]
    await payload.update({ collection: 'sessions', id: session.id, data: { seatsLeft: 0 } })
    await expect(
      payload.create({
        collection: 'bookings',
        data: { session: session.id, status: 'pending' },
        user: jonas,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/fully booked/)
  })

  it('does not let the public book', async () => {
    await expect(
      payload.create({
        collection: 'bookings',
        data: { session: ctx.sessions[1].id, status: 'pending' },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})

describe('users', () => {
  it('makes every self-registered user a member, even if they ask for admin', async () => {
    const user = await payload.create({
      collection: 'users',
      data: { name: 'Eve', email: 'eve@kiln.test', password: 'password123', role: 'admin' },
      overrideAccess: false,
    })
    expect(user.role).toBe('member')
  })

  it('lets members read and update only themselves, and not their role', async () => {
    const { docs } = await payload.find({ collection: 'users', user: mara, overrideAccess: false })
    expect(docs.map((u) => u.id)).toEqual([mara.id])

    const updated = await payload.update({
      collection: 'users',
      id: mara.id,
      data: { name: 'Mara V.', role: 'admin', membershipStatus: 'cancelled' },
      user: mara,
      overrideAccess: false,
    })
    expect(updated.name).toBe('Mara V.')
    expect(updated.role).toBe('member')
    expect(updated.membershipStatus).toBe('active')

    await expect(
      payload.update({
        collection: 'users',
        id: jonas.id,
        data: { name: 'Hacked' },
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})
