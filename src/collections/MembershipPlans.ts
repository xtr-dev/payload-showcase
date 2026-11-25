import type { CollectionConfig } from 'payload'

import { anyone, isAdmin } from '@/access'
import { formatSlug } from '@/hooks/slugify'

export const MembershipPlans: CollectionConfig = {
  slug: 'membership-plans',
  labels: { singular: 'Membership plan', plural: 'Membership plans' },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'price', 'highlighted'], group: 'Studio' },
  access: {
    read: anyone,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  defaultSort: 'price',
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      admin: { position: 'sidebar' },
      hooks: { beforeValidate: [formatSlug('name')] },
    },
    { name: 'tagline', type: 'text' },
    {
      name: 'price',
      type: 'number',
      required: true,
      min: 0,
      admin: { description: 'Per month, in euro cents.' },
    },
    {
      name: 'perks',
      type: 'array',
      fields: [{ name: 'perk', type: 'text', required: true }],
    },
    { name: 'highlighted', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
  ],
}
