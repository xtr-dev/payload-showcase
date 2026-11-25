import { PluginPlaceholder } from '@/components/PluginPlaceholder'

import { ShowcaseSection } from '../ShowcaseSection'

/**
 * Showcase for @xtr-dev/payload-notifications. Phase 2 owns this file: replace the placeholder with a live demo and set
 * `status="live"`.
 */
export const NotificationsShowcase = () => (
  <ShowcaseSection
    id="notifications"
    pkg="@xtr-dev/payload-notifications"
    title="An inbox for members"
    intro="Members get in-app notifications for bookings, reminders and studio news, with optional web push."
    features={[
      'Per-member inbox with read and unread state',
      'Channels such as Studio news that members can follow',
      'Optional web push on supported browsers',
    ]}
    usedOn={[['My studio', '/account#notifications']]}
    status="planned"
    tone="paper"
  >
    <PluginPlaceholder plugin="@xtr-dev/payload-notifications">
      A sample inbox with booking and studio-news notifications.
    </PluginPlaceholder>
  </ShowcaseSection>
)
