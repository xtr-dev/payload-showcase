import type { Payload } from 'payload'

import {
  getFeatureFlag,
  getUserVariant,
  isFeatureEnabled,
  isUserInRollout,
} from '@xtr-dev/payload-feature-flags/rsc'

/**
 * Request-independent feature-flag logic, shared by src/lib/flags.ts (pages), the tracking
 * endpoint in src/plugins/featureFlags.ts and the integration tests. Nothing here reads cookies or
 * imports the Payload config, so it can run inside the config itself and outside Next.js.
 */

export type FlagName =
  /** Gates the /gift-cards page and its navigation link. */
  | 'gift-cards'
  /** Rolls out BookingFlowV2 on the /book/[sessionId] page. */
  | 'new-booking-flow'
  /** Gates the studio shop (/shop and everything under it) and its navigation link. */
  | 'shop'

export type ExperimentName = 'home-hero'

export type Variant = 'a' | 'b'

export const FLAG_NAMES: FlagName[] = ['gift-cards', 'new-booking-flow', 'shop']
export const EXPERIMENT_NAMES: ExperimentName[] = ['home-hero']
export const VARIANTS: Variant[] = ['a', 'b']

/** Slug of the plugin's flags collection (the plugin default). */
export const FLAGS_SLUG = 'feature-flags'
/** Slug of the site collection that stores A/B test exposures and conversions. */
export const EVENTS_SLUG = 'experiment-events'

/** Random per-browser id, set by src/proxy.ts. Experiments and rollouts bucket on it. */
export const VISITOR_COOKIE = 'kiln_vid'
/** Visitor cookie lifetime: half a year, so an assignment survives between visits. */
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 180

/**
 * Cookie that pins a visitor to one variant of an experiment, set by the "preview" buttons on
 * /showcase and by the e2e tests. Visits with a preview cookie are not counted in the results.
 */
export const previewCookie = (experiment: ExperimentName) => `kiln_preview_${experiment}`

export const isVariant = (value: unknown): value is Variant =>
  typeof value === 'string' && (VARIANTS as string[]).includes(value)

export const isExperiment = (value: unknown): value is ExperimentName =>
  typeof value === 'string' && (EXPERIMENT_NAMES as string[]).includes(value)

/**
 * Whether a flag is on for a visitor or user. Without a subject only the on/off switch counts;
 * with one, the flag's rollout percentage applies too (sticky per subject).
 */
export const evaluateFlag = async (
  payload: Payload,
  flag: string,
  subjectId?: number | string,
): Promise<boolean> => {
  if (subjectId === undefined || subjectId === '') return isFeatureEnabled(flag, payload)
  // The plugin buckets per flag (it hashes the flag name with the id), so each rollout and
  // experiment gets an independent split, and a rollout of 0% means nobody.
  return isUserInRollout(flag, String(subjectId), payload)
}

/**
 * The variant of an experiment for a visitor or user. Falls back to the control (`a`) when the
 * experiment is off, has no variants, or there is no subject to bucket.
 */
export const assignVariant = async (
  payload: Payload,
  experiment: ExperimentName,
  subjectId?: number | string,
): Promise<Variant> => {
  if (subjectId === undefined || subjectId === '') return 'a'
  const variant = await getUserVariant(experiment, String(subjectId), payload)
  return isVariant(variant) ? variant : 'a'
}

export type ExperimentEventType = 'exposure' | 'conversion'

export const isEventType = (value: unknown): value is ExperimentEventType =>
  value === 'exposure' || value === 'conversion'

/**
 * Stores one exposure or conversion. Each visitor counts at most once per experiment and event
 * type, so reloads and repeated clicks don't inflate the numbers. Returns whether it was new.
 */
export const recordExperimentEvent = async (
  payload: Payload,
  event: {
    experiment: ExperimentName
    variant: Variant
    type: ExperimentEventType
    visitorId: string
  },
): Promise<boolean> => {
  const existing = await payload.count({
    collection: EVENTS_SLUG,
    where: {
      experiment: { equals: event.experiment },
      type: { equals: event.type },
      visitorId: { equals: event.visitorId },
    },
  })
  if (existing.totalDocs > 0) return false
  await payload.create({ collection: EVENTS_SLUG, data: event })
  return true
}

export interface VariantResult {
  variant: Variant
  /** Configured traffic share, in percent. */
  weight: number
  exposures: number
  conversions: number
  /** Conversions per exposure, 0..1; null before the first exposure. */
  rate: number | null
}

/** Exposures, conversions and conversion rate per variant of an experiment. */
export const getExperimentResults = async (
  payload: Payload,
  experiment: ExperimentName,
): Promise<VariantResult[]> => {
  const flag = await getFeatureFlag(experiment, payload)
  const count = async (variant: Variant, type: ExperimentEventType) =>
    (
      await payload.count({
        collection: EVENTS_SLUG,
        where: {
          experiment: { equals: experiment },
          variant: { equals: variant },
          type: { equals: type },
        },
      })
    ).totalDocs

  return Promise.all(
    VARIANTS.map(async (variant) => {
      const [exposures, conversions] = await Promise.all([
        count(variant, 'exposure'),
        count(variant, 'conversion'),
      ])
      return {
        variant,
        weight: flag?.variants?.find((v) => v.name === variant)?.weight ?? 0,
        exposures,
        conversions,
        rate: exposures > 0 ? conversions / exposures : null,
      }
    }),
  )
}
