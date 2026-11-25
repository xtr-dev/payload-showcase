import { PluginPlaceholder } from '@/components/PluginPlaceholder'

import { ShowcaseSection } from '../ShowcaseSection'

/**
 * Showcase for @xtr-dev/payload-mailing. Phase 2 owns this file: replace the placeholder with a live demo and set
 * `status="live"`.
 */
export const MailingShowcase = () => (
  <ShowcaseSection
    id="mailing"
    pkg="@xtr-dev/payload-mailing"
    title="Emails from templates"
    intro="Booking confirmations, class reminders and a monthly newsletter, written as templates in the admin panel."
    features={[
      'Templates with variables, edited in the admin panel',
      'Reminder emails scheduled before each class',
      'Captured locally in development: no SMTP needed',
    ]}
    usedOn={[['My studio settings', '/account#settings']]}
    status="planned"
    tone="bisque"
  >
    <PluginPlaceholder plugin="@xtr-dev/payload-mailing">
      A preview of the booking confirmation email and the latest captured messages.
    </PluginPlaceholder>
  </ShowcaseSection>
)
