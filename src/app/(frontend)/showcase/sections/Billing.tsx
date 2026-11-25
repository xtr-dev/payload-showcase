import { PluginPlaceholder } from '@/components/PluginPlaceholder'

import { ShowcaseSection } from '../ShowcaseSection'

/**
 * Showcase for @xtr-dev/payload-billing. Phase 2 owns this file: replace the placeholder with a live demo and set
 * `status="live"`.
 */
export const BillingShowcase = () => (
  <ShowcaseSection
    id="billing"
    pkg="@xtr-dev/payload-billing"
    title="Bookings and memberships, paid"
    intro="Every workshop seat and membership goes through a real checkout, with payments, invoices and refunds tracked in Payload."
    features={[
      'Local test provider out of the box; Stripe or Mollie with an API key',
      'A payment and an invoice for each booking',
      'Refunds release the seat back to the session',
    ]}
    usedOn={[
      ['Workshop booking', '/workshops'],
      ['Membership', '/membership'],
    ]}
    status="planned"
    tone="paper"
  >
    <PluginPlaceholder plugin="@xtr-dev/payload-billing">
      A live checkout using the local test provider, and the resulting payment and invoice.
    </PluginPlaceholder>
  </ShowcaseSection>
)
