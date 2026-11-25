import type { Plugin } from 'payload'

import { automation } from './automation'
import { billing } from './billing'
import { featureFlags } from './featureFlags'
import { mailing } from './mailing'
import { notifications } from './notifications'

/**
 * Every xtr-dev plugin integration, one file per plugin.
 *
 * Order matters: Payload applies plugins in sequence, so later plugins see the collections that
 * earlier ones added. Automation comes last so its triggers can target collections from billing,
 * mailing and notifications.
 */
export const plugins: Plugin[] = [
  ...billing,
  ...mailing,
  ...notifications,
  ...featureFlags,
  ...automation,
]
