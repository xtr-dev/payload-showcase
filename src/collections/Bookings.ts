import { APIError, type CollectionConfig } from 'payload'

import { getUser, isAdmin, isAdminField, isAdminUser, isLoggedIn } from '@/access'
import type { Booking } from '@/payload-types'

/** Statuses in which a booking occupies a seat in its session. */
export const SEAT_HOLDING_STATUSES: ReadonlyArray<Booking['status']> = ['pending', 'paid']

const holdsSeat = (status: Booking['status'] | undefined | null): boolean =>
  !!status && SEAT_HOLDING_STATUSES.includes(status)

const relId = (value: unknown): number | string | undefined => {
  if (value && typeof value === 'object' && 'id' in value) return (value as { id: number }).id
  return value as number | string | undefined
}

const makeReference = (): string =>
  `KC-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Date.now().toString(36).slice(-3).toUpperCase()}`

export const Bookings: CollectionConfig = {
  slug: 'bookings',
  admin: {
    useAsTitle: 'reference',
    defaultColumns: ['reference', 'member', 'session', 'status', 'amount', 'createdAt'],
    group: 'Studio',
  },
  access: {
    // Admins see every booking; members only see their own; the public sees none.
    read: ({ req }) => {
      const user = getUser(req)
      if (!user) return false
      if (isAdminUser(user)) return true
      return { member: { equals: user.id } }
    },
    create: isLoggedIn,
    // Status changes happen through admins or server-side code (billing webhooks, hooks)
    // that runs with overrideAccess.
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [
      async ({ data, req, operation, originalDoc }) => {
        const user = getUser(req)
        const sessionId = relId(data.session ?? originalDoc?.session)
        if (!sessionId) throw new APIError('A booking needs a session.', 400)

        if (operation === 'create') {
          // Non-admins always book for themselves, regardless of what they submit.
          if (user && !isAdminUser(user)) data.member = user.id
          if (!data.member) throw new APIError('A booking needs a member.', 400)

          const session = await req.payload.findByID({
            collection: 'sessions',
            id: sessionId,
            depth: 0,
            req,
          })
          if (session.status === 'cancelled') {
            throw new APIError('This session has been cancelled.', 400)
          }
          if (new Date(session.startsAt).getTime() < Date.now()) {
            throw new APIError('This session has already taken place.', 400)
          }
          if (holdsSeat(data.status ?? 'pending') && (session.seatsLeft ?? 0) < 1) {
            throw new APIError('This session is fully booked.', 409)
          }

          const existing = await req.payload.count({
            collection: 'bookings',
            where: {
              and: [
                { member: { equals: data.member } },
                { session: { equals: sessionId } },
                { status: { in: SEAT_HOLDING_STATUSES } },
              ],
            },
            req,
          })
          if (existing.totalDocs > 0) {
            throw new APIError('You already have a seat in this session.', 409)
          }

          const workshop = await req.payload.findByID({
            collection: 'workshops',
            id: relId(session.workshop)!,
            depth: 0,
            draft: true,
            req,
          })
          data.workshop = workshop.id
          // The price is always taken from the workshop, never from the request.
          if (!isAdminUser(user) || data.amount === undefined || data.amount === null) {
            data.amount = workshop.price
          }
          data.currency ||= 'EUR'
          data.reference ||= makeReference()
        }
        return data
      },
    ],
    afterChange: [
      // Keeps Sessions.seatsLeft in sync: a booking takes a seat while it is pending or paid
      // and gives it back when it is cancelled or refunded.
      async ({ doc, previousDoc, operation, req }) => {
        const before = operation === 'create' ? false : holdsSeat(previousDoc?.status)
        const after = holdsSeat(doc.status)
        if (before === after) return doc
        const sessionId = relId(doc.session)!
        const session = await req.payload.findByID({
          collection: 'sessions',
          id: sessionId,
          depth: 0,
          req,
        })
        const delta = after ? -1 : 1
        await req.payload.update({
          collection: 'sessions',
          id: sessionId,
          data: { seatsLeft: Math.max(0, (session.seatsLeft ?? 0) + delta) },
          req,
        })
        return doc
      },
    ],
  },
  fields: [
    {
      name: 'reference',
      type: 'text',
      unique: true,
      admin: { readOnly: true, description: 'Generated when the booking is created.' },
    },
    {
      name: 'member',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      access: { update: isAdminField },
    },
    {
      name: 'session',
      type: 'relationship',
      relationTo: 'sessions',
      required: true,
      index: true,
      access: { update: isAdminField },
    },
    {
      name: 'workshop',
      type: 'relationship',
      relationTo: 'workshops',
      admin: { readOnly: true, description: 'Copied from the session.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending payment', value: 'pending' },
        { label: 'Paid', value: 'paid' },
        { label: 'Cancelled', value: 'cancelled' },
        { label: 'Refunded', value: 'refunded' },
      ],
      // Only admins (or server code using overrideAccess, such as billing) set the status.
      access: { create: isAdminField, update: isAdminField },
      admin: { position: 'sidebar' },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'amount',
          type: 'number',
          min: 0,
          admin: { description: 'In cents. Copied from the workshop price.' },
          access: { create: isAdminField, update: isAdminField },
        },
        {
          name: 'currency',
          type: 'text',
          defaultValue: 'EUR',
          access: { create: isAdminField, update: isAdminField },
        },
      ],
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { description: 'Anything the studio should know (allergies, accessibility needs).' },
    },
  ],
}
