import { PluginPlaceholder } from '@/components/PluginPlaceholder'

import { ShowcaseSection } from '../ShowcaseSection'

/**
 * Showcase for @xtr-dev/payload-automation. Phase 2 owns this file: replace the placeholder with a live demo and set
 * `status="live"`.
 */
export const AutomationShowcase = () => (
  <ShowcaseSection
    id="automation"
    pkg="@xtr-dev/payload-automation"
    title="Workflows that run themselves"
    intro="Studio routines as workflows: when a booking is paid, send the confirmation and post a notification."
    features={[
      'Booking paid → confirmation email + notification',
      'A webhook-triggered workflow',
      'Run history for every workflow in the admin panel',
    ]}
    usedOn={[]}
    status="planned"
    tone="paper"
  >
    <PluginPlaceholder plugin="@xtr-dev/payload-automation">
      A diagram of the booking-paid workflow and its latest runs.
    </PluginPlaceholder>
  </ShowcaseSection>
)
