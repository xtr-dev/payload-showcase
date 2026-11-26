'use client'

import { useActionState } from 'react'

import { Alert, Button } from '@/components/ui'

import { runDigestAction, type DigestState } from './actions'
import { RunList } from './RunList'

/** Admin-only: starts the "Studio digest" workflow's manual trigger and shows the finished run. */
export const DigestButton = () => {
  const [state, action, pending] = useActionState<DigestState, FormData>(runDigestAction, {})
  return (
    <form action={action} className="mt-4" data-testid="digest-form">
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Running…' : 'Run the studio digest now'}
      </Button>
      {state.error && (
        <Alert tone="danger" className="mt-4">
          {state.error}
        </Alert>
      )}
      {state.run && (
        <div className="mt-4" data-testid="digest-result">
          <p className="text-sm font-semibold text-ink">Result of this run</p>
          <RunList runs={[state.run]} adminLinks />
        </div>
      )}
    </form>
  )
}
