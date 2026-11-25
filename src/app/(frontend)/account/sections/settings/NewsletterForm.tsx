'use client'

import { useActionState } from 'react'

import { Alert, Button } from '@/components/ui'

import { type NewsletterState, updateNewsletter } from './newsletterActions'

/** Subscribe/unsubscribe button for the newsletter, with the result announced to screen readers. */
export const NewsletterForm = ({ subscribed }: { subscribed: boolean }) => {
  const [state, action, pending] = useActionState<NewsletterState, FormData>(updateNewsletter, {})
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="subscribe" value={subscribed ? 'false' : 'true'} />
      <Button
        type="submit"
        size="sm"
        variant={subscribed ? 'outline' : 'primary'}
        disabled={pending}
      >
        {pending ? 'Saving…' : subscribed ? 'Unsubscribe' : 'Subscribe to the newsletter'}
      </Button>
      {state.message && <Alert tone="success">{state.message}</Alert>}
      {state.error && <Alert tone="danger">{state.error}</Alert>}
    </form>
  )
}
