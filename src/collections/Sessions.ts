import type { CollectionConfig } from 'payload'

import { getUser, isAdmin, isAdminUser } from '@/access'

export const Sessions: CollectionConfig = {
  slug: 'sessions',
  labels: { singular: 'Session', plural: 'Sessions' },
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'startsAt', 'seatsLeft', 'status'],
    group: 'Studio',
  },
  access: {
    // The public can read sessions of published workshops; admins can read all of them.
    read: ({ req }) => {
      if (isAdminUser(getUser(req))) return true
      return { 'workshop._status': { equals: 'published' } }
    },
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  defaultSort: 'startsAt',
  hooks: {
    beforeChange: [
      async ({ data, req, operation }) => {
        const workshopId =
          typeof data.workshop === 'object' && data.workshop ? data.workshop.id : data.workshop
        if (!workshopId) return data
        const workshop = await req.payload.findByID({
          collection: 'workshops',
          id: workshopId,
          depth: 0,
          draft: true,
          req,
        })
        // New sessions start with every seat available.
        if (operation === 'create' && (data.seatsLeft === undefined || data.seatsLeft === null)) {
          data.seatsLeft = workshop.capacity
        }
        if (data.startsAt) {
          const date = new Date(data.startsAt).toISOString().slice(0, 16).replace('T', ' ')
          data.label = `${workshop.title} — ${date}`
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'workshop',
      type: 'relationship',
      relationTo: 'workshops',
      required: true,
      index: true,
    },
    {
      name: 'startsAt',
      type: 'date',
      required: true,
      index: true,
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'seatsLeft',
      type: 'number',
      min: 0,
      admin: {
        description:
          'Defaults to the workshop capacity. Bookings reserve and release seats automatically.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'scheduled',
      options: [
        { label: 'Scheduled', value: 'scheduled' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'label',
      type: 'text',
      admin: { hidden: true },
    },
  ],
}
