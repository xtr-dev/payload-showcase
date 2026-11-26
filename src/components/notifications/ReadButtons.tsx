'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui'

/**
 * Inbox buttons that change the signed-in member's read state through the plugin's REST endpoint:
 * `POST /api/notifications/:id/read` marks a notification read, `DELETE` marks it unread. The
 * endpoint works for personal notifications and broadcasts alike (a broadcast gets a per-member
 * read receipt). Afterwards the page is refreshed, so the inbox and the header bell update.
 */

const setRead = async (id: number, read: boolean): Promise<void> => {
  const res = await fetch(`/api/notifications/${id}/read`, {
    method: read ? 'POST' : 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`The notification could not be updated (${res.status}).`)
}

const useReadAction = () => {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const run = (ids: number[], read: boolean) =>
    startTransition(async () => {
      setError(null)
      try {
        for (const id of ids) await setRead(id, read)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.')
      }
    })
  return { pending, error, run }
}

const ErrorText = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="mt-1 text-sm text-danger">
      {error}
    </p>
  ) : null

/** "Mark as read" for an unread notification, "Mark as unread" for a read one. */
export const ReadToggle = ({ id, title, read }: { id: number; title: string; read: boolean }) => {
  const { pending, error, run } = useReadAction()
  return (
    <div>
      <Button
        type="button"
        variant={read ? 'ghost' : 'outline'}
        size="sm"
        disabled={pending}
        onClick={() => run([id], !read)}
        aria-label={read ? `Mark “${title}” as unread` : `Mark “${title}” as read`}
      >
        {read ? 'Mark as unread' : 'Mark as read'}
      </Button>
      <ErrorText error={error} />
    </div>
  )
}

/** Marks every listed notification as read, one endpoint call each. */
export const MarkAllReadButton = ({ ids }: { ids: number[] }) => {
  const { pending, error, run } = useReadAction()
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run(ids, true)}
      >
        Mark all as read
      </Button>
      <ErrorText error={error} />
    </div>
  )
}
