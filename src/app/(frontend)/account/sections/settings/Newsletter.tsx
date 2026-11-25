import { PluginPlaceholder } from '@/components/PluginPlaceholder'
import type { User } from '@/payload-types'

/** Newsletter opt-in. Phase 2 (mailing) owns this file. */
export const NewsletterSetting = async (_props: { user: User }) => (
  <PluginPlaceholder plugin="@xtr-dev/payload-mailing">
    Subscribe to the monthly studio newsletter.
  </PluginPlaceholder>
)
