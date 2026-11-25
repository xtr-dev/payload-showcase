import type { Plugin } from 'payload'

/**
 * @xtr-dev/payload-billing
 *
 * Checkout for workshop bookings and memberships (local test provider by default, Stripe/Mollie via env), payments, invoices and refunds.
 *
 * Phase 2 owns this file. Export every Payload plugin this integration needs (the plugin
 * itself plus any `extendCollection`/`addFields` tweaks from ./utils). It is spread into
 * `config.plugins` by ./index.ts; see docs/ARCHITECTURE.md.
 */
export const billing: Plugin[] = []
