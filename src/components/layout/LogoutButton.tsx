'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button, type ButtonVariant } from '@/components/ui/Button'

export const LogoutButton = ({ variant = 'ghost' }: { variant?: ButtonVariant }) => {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        await fetch('/api/users/logout', { method: 'POST', credentials: 'include' })
        router.push('/')
        router.refresh()
      }}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
