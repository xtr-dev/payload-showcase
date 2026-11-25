import { Card } from '@/components/ui'
import type { User } from '@/payload-types'

import { NewsletterSetting } from './settings/Newsletter'
import { PushSetting } from './settings/Push'

/**
 * Account settings. Each plugin owns one setting component in ./settings, so phase-2 agents never
 * edit this file at the same time.
 */
export const SettingsSection = ({ user }: { user: User }) => (
  <Card as="section" className="p-6" aria-labelledby="settings-heading" id="settings">
    <h2 id="settings-heading" className="text-2xl text-ink">
      Settings
    </h2>
    <div className="mt-4 space-y-4">
      <NewsletterSetting user={user} />
      <PushSetting user={user} />
    </div>
  </Card>
)
