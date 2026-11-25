import type { Plugin } from 'payload'

/**
 * @xtr-dev/payload-feature-flags
 *
 * Homepage hero A/B test, the gated gift-cards feature and the new-booking-flow rollout. Implement src/lib/flags.ts on top of it.
 *
 * Phase 2 owns this file. Export every Payload plugin this integration needs (the plugin
 * itself plus any `extendCollection`/`addFields` tweaks from ./utils). It is spread into
 * `config.plugins` by ./index.ts; see docs/ARCHITECTURE.md.
 */
export const featureFlags: Plugin[] = []
