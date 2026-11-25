import { PluginPlaceholder } from '@/components/PluginPlaceholder'
import { Card } from '@/components/ui'
import type { User } from '@/payload-types'

/**
 * The member's in-app inbox (booking confirmed, class reminders, studio news).
 *
 * Phase 2 (notifications) owns this file.
 */
export const NotificationsSection = async (_props: { user: User }) => (
  <Card as="section" className="p-6" aria-labelledby="notifications-heading" id="notifications">
    <h2 id="notifications-heading" className="text-2xl text-ink">
      Notifications
    </h2>
    <div className="mt-4">
      <PluginPlaceholder plugin="@xtr-dev/payload-notifications">
        Your inbox: booking confirmations, class reminders and studio news.
      </PluginPlaceholder>
    </div>
  </Card>
)
