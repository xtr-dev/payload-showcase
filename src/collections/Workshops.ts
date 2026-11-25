import type { CollectionConfig } from 'payload'

import { isAdmin, publishedOrAdmin } from '@/access'
import { formatSlug } from '@/hooks/slugify'

export const WORKSHOP_LEVELS = [
  { label: 'First time on the wheel', value: 'beginner' },
  { label: 'Some experience', value: 'intermediate' },
  { label: 'Confident maker', value: 'advanced' },
  { label: 'All levels', value: 'all' },
] as const

export const WORKSHOP_FORMATS = [
  { label: 'One-off class', value: 'one-off' },
  { label: 'Multi-week course', value: 'course' },
] as const

export const Workshops: CollectionConfig = {
  slug: 'workshops',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'format', 'level', 'price', '_status'],
    group: 'Studio',
  },
  versions: { drafts: true },
  access: {
    read: publishedOrAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  defaultSort: 'title',
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { position: 'sidebar', description: 'Generated from the title when left empty.' },
      hooks: { beforeValidate: [formatSlug('title')] },
    },
    {
      name: 'summary',
      type: 'textarea',
      required: true,
      maxLength: 220,
      admin: { description: 'One or two sentences, shown on workshop cards.' },
    },
    { name: 'description', type: 'richText' },
    {
      type: 'row',
      fields: [
        {
          name: 'price',
          type: 'number',
          required: true,
          min: 0,
          admin: { description: 'Per seat, in euro cents (6500 = €65.00).' },
        },
        { name: 'capacity', type: 'number', required: true, min: 1, defaultValue: 8 },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'format',
          type: 'select',
          required: true,
          defaultValue: 'one-off',
          options: [...WORKSHOP_FORMATS],
        },
        {
          name: 'level',
          type: 'select',
          required: true,
          defaultValue: 'beginner',
          options: [...WORKSHOP_LEVELS],
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'duration',
          type: 'number',
          required: true,
          min: 15,
          admin: { description: 'Length of one session, in minutes.' },
        },
        {
          name: 'weeks',
          type: 'number',
          min: 1,
          admin: {
            description: 'Number of weekly sessions (courses only).',
            condition: (data) => data?.format === 'course',
          },
        },
      ],
    },
    { name: 'instructor', type: 'text' },
    {
      name: 'images',
      type: 'upload',
      relationTo: 'media',
      hasMany: true,
      admin: { description: 'The first image is used on cards.' },
    },
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar' },
    },
  ],
}
