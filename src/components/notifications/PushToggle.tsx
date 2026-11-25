'use client'

import { usePushNotifications } from '@xtr-dev/payload-notifications/client'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui'

import { sendTestNotification } from './actions'

/**
 * Subscribes this browser to web push through the plugin's client hook, which registers the
 * plugin's service worker (served at /sw.js) and posts the subscription to
 * /api/push-notifications/subscribe.
 */
export const PushToggle = ({ publicKey, channels }: { publicKey: string; channels: string[] }) => {
  const { isSupported, isSubscribed, permission, subscribe, unsubscribe, pushManager } =
    usePushNotifications(publicKey, channels)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const run = (action: () => Promise<unknown>) =>
    startTransition(async () => {
      setError(null)
      try {
        await action()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.')
      }
    })

  // The hook checks browser support in an effect, so the first render (and SSR) can't know yet.
  if (!pushManager) {
    return <p className="mt-1 text-sm text-ink-soft">Checking this browser…</p>
  }
  if (!isSupported) {
    return (
      <p className="mt-1 text-sm text-ink-soft">
        This browser doesn’t support web push. Your inbox still works.
      </p>
    )
  }
  if (permission === 'denied') {
    return (
      <p className="mt-1 text-sm text-ink-soft">
        Notifications are blocked for this site. Allow them in your browser settings to turn push
        on.
      </p>
    )
  }

  return (
    <div className="mt-1 space-y-2 text-sm text-ink-soft">
      <p role="status">
        {isSubscribed
          ? 'Push is on for this device.'
          : 'Get booking updates and the channels above as push notifications on this device.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {isSubscribed ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(sendTestNotification)}
            >
              Send a test push
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(unsubscribe)}>
              Turn off
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(subscribe)}>
            Turn on push
          </Button>
        )}
      </div>
      {error && <p className="font-medium text-danger">{error}</p>}
    </div>
  )
}
