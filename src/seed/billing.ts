import type { Payload } from 'payload'

import type { SeedContext } from './types'

/**
 * Seed data for the Billing integration. Phase 2 owns this file.
 *
 * Runs after the core seed (see ./index.ts), so `ctx` holds the seeded users, workshops,
 * sessions and bookings. It must be safe on an empty database and must clean up its own
 * collections when `reset` is true.
 */
export const seedBilling = async (
  _payload: Payload,
  _ctx: SeedContext,
  _options: { reset: boolean },
): Promise<void> => {}
