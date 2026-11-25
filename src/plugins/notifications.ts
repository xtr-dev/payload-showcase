import type { Plugin } from 'payload'

/**
 * @xtr-dev/payload-notifications
 *
 * In-app inbox for members (booking confirmed, class reminders, studio news channels) and optional web push.
 *
 * Phase 2 owns this file. Export every Payload plugin this integration needs (the plugin
 * itself plus any `extendCollection`/`addFields` tweaks from ./utils). It is spread into
 * `config.plugins` by ./index.ts; see docs/ARCHITECTURE.md.
 */
export const notifications: Plugin[] = []
