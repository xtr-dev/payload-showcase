import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { Bookings } from './collections/Bookings'
import { Media } from './collections/Media'
import { MembershipPlans } from './collections/MembershipPlans'
import { Sessions } from './collections/Sessions'
import { Users } from './collections/Users'
import { Workshops } from './collections/Workshops'
import { Home } from './globals/Home'
import { SiteSettings } from './globals/SiteSettings'
import { plugins } from './plugins'
import { seedIfEmpty } from './seed/onInit'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || '',
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: ' · Kiln & Co.',
    },
  },
  collections: [Users, Media, Workshops, Sessions, Bookings, MembershipPlans],
  globals: [Home, SiteSettings],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || 'file:./kiln.db',
    },
  }),
  sharp,
  plugins,
  onInit: seedIfEmpty,
})
