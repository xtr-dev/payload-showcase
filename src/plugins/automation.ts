import type { Plugin } from 'payload'

/**
 * @xtr-dev/payload-automation
 *
 * Workflows such as booking paid -> confirmation email + notification, and a webhook-triggered workflow.
 *
 * Phase 2 owns this file. Export every Payload plugin this integration needs (the plugin
 * itself plus any `extendCollection`/`addFields` tweaks from ./utils). It is spread into
 * `config.plugins` by ./index.ts; see docs/ARCHITECTURE.md.
 */
export const automation: Plugin[] = []
