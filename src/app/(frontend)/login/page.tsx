import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { LoginForm } from '@/components/auth/AuthForms'
import { AuthShell } from '@/components/auth/AuthShell'
import { getCurrentUser, safeNext } from '@/lib/auth'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const next = safeNext((await searchParams).next)
  if (await getCurrentUser()) redirect(next)
  return (
    <AuthShell
      title="Welcome back"
      intro="Sign in to see your bookings, manage your membership and pick up where you left off."
    >
      <LoginForm next={next} />
    </AuthShell>
  )
}
