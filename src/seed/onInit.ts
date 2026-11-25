import type { Payload } from 'payload'

import { seed } from './index'

/**
 * Payload `onInit` hook: seeds an empty development database on first boot, so `pnpm dev` works
 * without a separate `pnpm seed`. Set SEED_ON_INIT=false to turn this off.
 */
export const seedIfEmpty = async (payload: Payload): Promise<void> => {
  if (process.env.NODE_ENV !== 'development' || process.env.SEED_ON_INIT === 'false') return
  const { totalDocs } = await payload.count({ collection: 'users', overrideAccess: true })
  if (totalDocs > 0) return
  await seed(payload, { reset: false })
}
