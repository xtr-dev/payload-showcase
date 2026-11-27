import type { Payload } from 'payload'

import { EVENTS_SLUG, FLAGS_SLUG } from '@/lib/experiments'
import type { FeatureFlag } from '@/payload-types'

import type { SeedContext } from './types'

type FlagSeed = Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>

/** The flags the site reads (see src/lib/flags.ts). */
export const FLAG_SEEDS: FlagSeed[] = [
  {
    name: 'home-hero',
    description:
      'A/B test of the homepage hero. Variant a is the control ("Get your hands in the clay."); variant b is the beginner-focused copy from the "Hero (variant B)" tab of the Homepage global.',
    enabled: true,
    rolloutPercentage: 100,
    variants: [
      { name: 'a', weight: 60, metadata: { label: 'Control: studio intro' } },
      { name: 'b', weight: 40, metadata: { label: 'Beginner pitch' } },
    ],
    tags: [{ tag: 'experiment' }, { tag: 'homepage' }],
  },
  {
    name: 'gift-cards',
    description:
      'Shows the Gift cards page and its navigation link. Off means /gift-cards is a 404.',
    enabled: true,
    rolloutPercentage: 100,
    tags: [{ tag: 'release' }],
  },
  {
    name: 'new-booking-flow',
    description:
      'Rolls out the new booking flow (BookingFlowV2, which asks for experience level and shows a live summary) on /book/[sessionId]. Signed-in members are bucketed by user id, so each keeps the same flow on every device.',
    enabled: true,
    rolloutPercentage: 50,
    tags: [{ tag: 'rollout' }, { tag: 'booking' }],
  },
  {
    name: 'shop',
    description:
      'Shows the studio shop and its navigation link. Off means /shop and every page under it is a 404.',
    enabled: true,
    rolloutPercentage: 100,
    tags: [{ tag: 'release' }, { tag: 'shop' }],
  },
]

/**
 * Seeds the feature flags. Flags are upserted by name, so the seed also works without `reset` on
 * a database that already has them. With `reset`, all flags and recorded experiment events are
 * removed first.
 */
export const seedFeatureFlags = async (
  payload: Payload,
  _ctx: SeedContext,
  { reset }: { reset: boolean },
): Promise<void> => {
  if (reset) {
    await payload.delete({ collection: EVENTS_SLUG, where: { id: { exists: true } } })
    await payload.delete({ collection: FLAGS_SLUG, where: { id: { exists: true } } })
  }
  for (const flag of FLAG_SEEDS) {
    const existing = await payload.find({
      collection: FLAGS_SLUG,
      where: { name: { equals: flag.name } },
      limit: 1,
    })
    if (existing.docs[0]) {
      await payload.update({ collection: FLAGS_SLUG, id: existing.docs[0].id, data: flag })
    } else {
      await payload.create({ collection: FLAGS_SLUG, data: flag })
    }
  }
  payload.logger.info(`Seeded ${FLAG_SEEDS.length} feature flags.`)
}
