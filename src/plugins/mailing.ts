import type { Plugin } from 'payload'

/**
 * @xtr-dev/payload-mailing
 *
 * Booking confirmation and reminder emails from templates, plus a scheduled newsletter. Dev and tests use a capturing transport.
 *
 * Phase 2 owns this file. Export every Payload plugin this integration needs (the plugin
 * itself plus any `extendCollection`/`addFields` tweaks from ./utils). It is spread into
 * `config.plugins` by ./index.ts; see docs/ARCHITECTURE.md.
 */
export const mailing: Plugin[] = []
