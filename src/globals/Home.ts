import type { Field, GlobalConfig } from 'payload'

import { anyone, isAdmin } from '@/access'

const heroFields: Field[] = [
  { name: 'eyebrow', type: 'text' },
  { name: 'heading', type: 'text', required: true },
  { name: 'subheading', type: 'textarea' },
  {
    type: 'row',
    fields: [
      { name: 'ctaLabel', type: 'text' },
      { name: 'ctaHref', type: 'text' },
    ],
  },
]

export const Home: GlobalConfig = {
  slug: 'home',
  label: 'Homepage',
  admin: { group: 'Content' },
  access: { read: anyone, update: isAdmin },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          name: 'hero',
          label: 'Hero',
          fields: [...heroFields, { name: 'image', type: 'upload', relationTo: 'media' }],
        },
        {
          name: 'heroVariantB',
          label: 'Hero (variant B)',
          description:
            'Alternative hero copy for the homepage A/B test. Which visitors see it is decided by the feature-flags plugin.',
          fields: [...heroFields],
        },
        {
          label: 'Featured',
          fields: [
            { name: 'featuredHeading', type: 'text' },
            {
              name: 'featuredWorkshops',
              type: 'relationship',
              relationTo: 'workshops',
              hasMany: true,
              maxRows: 3,
            },
          ],
        },
        {
          name: 'about',
          label: 'About',
          fields: [
            { name: 'heading', type: 'text' },
            { name: 'body', type: 'richText' },
            { name: 'image', type: 'upload', relationTo: 'media' },
          ],
        },
        {
          label: 'Testimonials',
          fields: [
            {
              name: 'testimonials',
              type: 'array',
              fields: [
                { name: 'quote', type: 'textarea', required: true },
                { name: 'name', type: 'text', required: true },
                { name: 'detail', type: 'text' },
              ],
            },
          ],
        },
      ],
    },
  ],
}
