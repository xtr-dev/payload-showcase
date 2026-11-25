import { PluginPlaceholder } from '@/components/PluginPlaceholder'
import type { User } from '@/payload-types'

/** Web push opt-in and notification channel preferences. Phase 2 (notifications) owns this file. */
export const PushSetting = async (_props: { user: User }) => (
  <PluginPlaceholder plugin="@xtr-dev/payload-notifications">
    Get class reminders as push notifications on this device.
  </PluginPlaceholder>
)
