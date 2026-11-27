import type { Payload } from 'payload'

import { seedAutomation } from './automation'
import { seedBilling } from './billing'
import { resetCore, seedCore } from './core'
import { seedEcommerce } from './ecommerce'
import { seedFeatureFlags } from './featureFlags'
import { seedMailing } from './mailing'
import { seedNotifications } from './notifications'
import type { SeedContext } from './types'

export type { SeedContext } from './types'

/** Plugin seeds, run in this order after the core seed. One file per plugin. */
const pluginSeeds = [
  seedBilling,
  seedMailing,
  seedNotifications,
  seedFeatureFlags,
  seedEcommerce,
  seedAutomation,
]

/**
 * Seeds the demo site. With `reset` (the default) all existing core data is removed first, so the
 * seed can be re-run at any time to get back to a known state.
 */
export const seed = async (
  payload: Payload,
  { reset = true }: { reset?: boolean } = {},
): Promise<SeedContext> => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production. The seed contains demo logins.')
  }
  if (reset) await resetCore(payload)
  payload.logger.info('Seeding Kiln & Co. demo data…')
  const ctx = await seedCore(payload)
  for (const pluginSeed of pluginSeeds) {
    await pluginSeed(payload, ctx, { reset })
  }
  payload.logger.info('Seed complete.')
  return ctx
}
