import { PushToggle } from '@/components/notifications/PushToggle'
import { saveNotificationChannels } from '@/components/notifications/actions'
import { Button } from '@/components/ui'
import { ALL_CHANNEL_IDS, CHANNELS, getFollowedChannels, vapidKeys } from '@/lib/notifications'
import { getPayloadClient } from '@/lib/payload'
import type { User } from '@/payload-types'

/**
 * Notification channel preferences (the plugin's per-member channel subscriptions: unticking a
 * channel opts the member out of it) and the web push opt-in for this device. Push only appears
 * when the server has VAPID keys; without them the inbox works and this explains why push is off.
 */
export const PushSetting = async ({ user }: { user: User }) => {
  const followed = await getFollowedChannels(await getPayloadClient(), user)
  const keys = vapidKeys()

  return (
    <div className="space-y-5" data-testid="notification-settings">
      <form action={saveNotificationChannels}>
        <fieldset>
          <legend className="font-semibold text-ink">Notification channels</legend>
          <ul className="mt-2 space-y-2">
            {CHANNELS.map((c) => (
              <li key={c.id}>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="channel"
                    value={c.id}
                    defaultChecked={!c.optional || followed.includes(c.id)}
                    disabled={!c.optional}
                    className="mt-0.5 size-4 accent-clay"
                  />
                  <span>
                    <span className="font-semibold text-ink">{c.name}</span>
                    <span className="block text-ink-soft">{c.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <Button type="submit" variant="outline" size="sm" className="mt-3">
          Save channels
        </Button>
      </form>

      <div>
        <h3 className="font-semibold text-ink">Push notifications</h3>
        {keys ? (
          <PushToggle publicKey={keys.publicKey} channels={ALL_CHANNEL_IDS} />
        ) : (
          <p className="mt-1 text-sm text-ink-soft" data-testid="push-disabled">
            Push is switched off on this server (no VAPID keys configured). Your inbox still works;
            see <code className="font-mono">.env.example</code> to turn it on.
          </p>
        )}
      </div>
    </div>
  )
}
