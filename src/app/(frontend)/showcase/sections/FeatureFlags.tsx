import { PluginPlaceholder } from '@/components/PluginPlaceholder'

import { ShowcaseSection } from '../ShowcaseSection'

/**
 * Showcase for @xtr-dev/payload-feature-flags. Phase 2 owns this file: replace the placeholder with a live demo and set
 * `status="live"`.
 */
export const FeatureFlagsShowcase = () => (
  <ShowcaseSection
    id="feature-flags"
    pkg="@xtr-dev/payload-feature-flags"
    title="Experiments and rollouts"
    intro="Flags decide which homepage hero you see, whether gift cards are on sale, and who gets the new booking flow."
    features={[
      'A/B test on the homepage hero',
      'Gift cards gated behind a flag',
      'Percentage rollout of the new booking flow',
    ]}
    usedOn={[
      ['Homepage', '/'],
      ['Booking', '/workshops'],
    ]}
    status="planned"
    tone="bisque"
  >
    <PluginPlaceholder plugin="@xtr-dev/payload-feature-flags">
      The current flags and your assigned variants, with a toggle to preview each one.
    </PluginPlaceholder>
  </ShowcaseSection>
)
