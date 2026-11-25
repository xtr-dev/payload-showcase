import path from 'path'
import type { CollectionConfig } from 'payload'

import { anyone, isAdmin } from '@/access'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: { group: 'Content' },
  access: {
    read: anyone,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: {
    // MEDIA_DIR lets tests and the e2e server keep uploads away from the dev media folder.
    staticDir: path.resolve(process.cwd(), process.env.MEDIA_DIR || 'media'),
    mimeTypes: ['image/*'],
  },
}
