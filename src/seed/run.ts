/**
 * Entry point for `pnpm seed` (runs through `payload run`, which loads .env and the config).
 */
import config from '@payload-config'
import { getPayload } from 'payload'

import { seed } from './index'

process.env.SEED_ON_INIT = 'false'

const payload = await getPayload({ config })
await seed(payload)
process.exit(0)
