import { payloadFeatureFlags } from '@xtr-dev/payload-feature-flags'
import type { CollectionConfig, Endpoint, Plugin } from 'payload'

import { isAdmin } from '@/access'
import {
  assignVariant,
  EVENTS_SLUG,
  isEventType,
  isExperiment,
  isVariant,
  previewCookie,
  recordExperimentEvent,
  VISITOR_COOKIE,
} from '@/lib/experiments'

/**
 * @xtr-dev/payload-feature-flags
 *
 * Homepage hero A/B test, the gated gift-cards feature and the new-booking-flow rollout. Pages
 * read the flags through src/lib/flags.ts.
 */

/** Reads one cookie from a request's Cookie header. */
const readCookie = (header: string | null, name: string): string | undefined => {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return undefined
}

/**
 * `POST /api/experiment-events/track` with `{ experiment, type }`, sent by HeroExperimentTracker
 * with `navigator.sendBeacon`. The variant is worked out again on the server from the visitor
 * cookie, so a client cannot credit a conversion to a variant it was not shown. Previews (a
 * preview cookie is set) and visitors without a cookie are ignored.
 */
const trackEndpoint: Endpoint = {
  path: '/track',
  method: 'post',
  handler: async (req) => {
    const body = (await req.json?.().catch(() => null)) as { experiment?: unknown; type?: unknown }
    if (!body || !isExperiment(body.experiment) || !isEventType(body.type)) {
      return Response.json({ error: 'Send { experiment, type }.' }, { status: 400 })
    }
    const cookieHeader = req.headers.get('cookie')
    const visitorId = readCookie(cookieHeader, VISITOR_COOKIE)
    if (!visitorId || isVariant(readCookie(cookieHeader, previewCookie(body.experiment)))) {
      return Response.json({ recorded: false })
    }
    const variant = await assignVariant(req.payload, body.experiment, visitorId)
    const recorded = await recordExperimentEvent(req.payload, {
      experiment: body.experiment,
      variant,
      type: body.type,
      visitorId,
    })
    return Response.json({ recorded, variant })
  },
}

/**
 * Exposures and conversions of the homepage hero A/B test. Written only by the tracking endpoint
 * (Local API); admins can read and clear them.
 */
const ExperimentEvents: CollectionConfig = {
  slug: EVENTS_SLUG,
  labels: { singular: 'Experiment event', plural: 'Experiment events' },
  admin: {
    group: 'Experiments',
    description:
      'One row per visitor and event: an exposure when they see a homepage hero variant, a conversion when they click its call to action.',
    defaultColumns: ['experiment', 'variant', 'type', 'visitorId', 'createdAt'],
  },
  access: { read: isAdmin, create: () => false, update: () => false, delete: isAdmin },
  endpoints: [trackEndpoint],
  fields: [
    { name: 'experiment', type: 'text', required: true, index: true },
    { name: 'variant', type: 'text', required: true, index: true },
    {
      name: 'type',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Exposure', value: 'exposure' },
        { label: 'Conversion', value: 'conversion' },
      ],
    },
    { name: 'visitorId', type: 'text', required: true, index: true },
  ],
}

const addExperimentEvents: Plugin = (config) => ({
  ...config,
  collections: [...(config.collections ?? []), ExperimentEvents],
})

export const featureFlags: Plugin[] = [
  payloadFeatureFlags({
    // Visitors never read the collection; the client hooks use the public evaluate endpoint,
    // which only answers on/off, variant and rollout for flags they name.
    publicEndpoint: true,
    // Cache the RSC helpers across requests (Next.js unstable_cache). The plugin clears the cache
    // when a flag is changed in the admin.
    cache: true,
    // Show the plugin's dashboard as the collection's list view. The standalone
    // /admin/feature-flags-overview view always shows "Authentication Required" in 0.1.0.
    enableCustomListView: true,
    collectionOverrides: {
      access: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin },
      admin: { group: 'Experiments' },
    },
  }),
  addExperimentEvents,
]
