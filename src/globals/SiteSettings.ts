import type { GlobalConfig } from 'payload'

import { anyone, isAdmin } from '@/access'

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site settings',
  admin: { group: 'Content' },
  access: { read: anyone, update: isAdmin },
  fields: [
    { name: 'siteName', type: 'text', required: true, defaultValue: 'Kiln & Co.' },
    { name: 'tagline', type: 'text' },
    {
      name: 'announcement',
      type: 'text',
      admin: { description: 'Shown in a thin bar above the navigation. Leave empty to hide.' },
    },
    {
      type: 'group',
      name: 'contact',
      fields: [
        { name: 'email', type: 'email' },
        { name: 'phone', type: 'text' },
        { name: 'address', type: 'textarea' },
      ],
    },
    {
      name: 'openingHours',
      type: 'array',
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'days', type: 'text', required: true },
            { name: 'hours', type: 'text', required: true },
          ],
        },
      ],
    },
    {
      name: 'social',
      type: 'array',
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'label', type: 'text', required: true },
            { name: 'url', type: 'text', required: true },
          ],
        },
      ],
    },
  ],
}
