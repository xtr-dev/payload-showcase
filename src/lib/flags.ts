/**
 * Feature flags and experiments used by the site, backed by @xtr-dev/payload-feature-flags.
 *
 * Pages call `isEnabled` and `getVariant`; both read the flags through the plugin's RSC helpers
 * (see ./experiments.ts) and bucket visitors on the `kiln_vid` cookie that src/proxy.ts sets.
 * Keep the signatures stable: pages outside the feature-flags integration depend on them.
 */
import { cookies } from 'next/headers'

import {
  assignVariant,
  evaluateFlag,
  isVariant,
  previewCookie,
  VISITOR_COOKIE,
  type ExperimentName,
  type FlagName,
  type Variant,
} from './experiments'
import { getPayloadClient } from './payload'

export type { ExperimentName, FlagName, Variant } from './experiments'

export interface FlagContext {
  /** Signed-in user id, when known; used for percentage rollouts. */
  userId?: number | string
}

/**
 * The request's cookies, or null outside a request (scripts, integration tests). Next.js
 * control-flow errors carry a `digest` and are rethrown so Next.js still sees them.
 */
const readCookies = async () => {
  try {
    return await cookies()
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error
    return null
  }
}

/** The visitor id from the `kiln_vid` cookie, if the browser has one. */
export const getVisitorId = async (): Promise<string | undefined> =>
  (await readCookies())?.get(VISITOR_COOKIE)?.value || undefined

/** The variant pinned by a preview cookie, if any. */
export const getPreviewVariant = async (experiment: ExperimentName): Promise<Variant | null> => {
  const value = (await readCookies())?.get(previewCookie(experiment))?.value
  return isVariant(value) ? value : null
}

/**
 * Whether a flag is on for this request. Rollouts bucket on the signed-in user when known (so a
 * member gets the same booking flow on every device), otherwise on the visitor cookie.
 */
export const isEnabled = async (flag: FlagName, ctx: FlagContext = {}): Promise<boolean> => {
  const payload = await getPayloadClient()
  return evaluateFlag(payload, flag, ctx.userId ?? (await getVisitorId()))
}

/**
 * Which variant of an experiment to show. Variant `a` is the control. For the homepage hero,
 * variant `b` renders the "Hero (variant B)" tab of the Homepage global.
 *
 * Assignment is sticky per browser: it buckets on the visitor cookie first, so signing in does not
 * flip the hero a visitor has been seeing. A preview cookie overrides the assignment.
 */
export const getVariant = async (
  experiment: ExperimentName,
  ctx: FlagContext = {},
): Promise<Variant> => {
  const preview = await getPreviewVariant(experiment)
  if (preview) return preview
  const payload = await getPayloadClient()
  return assignVariant(payload, experiment, (await getVisitorId()) ?? ctx.userId)
}
