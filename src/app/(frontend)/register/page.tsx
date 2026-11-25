import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { RegisterForm } from '@/components/auth/AuthForms'
import { AuthShell } from '@/components/auth/AuthShell'
import { getCurrentUser, safeNext } from '@/lib/auth'

export const metadata: Metadata = { title: 'Create an account' }

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const next = safeNext((await searchParams).next)
  if (await getCurrentUser()) redirect(next)
  return (
    <AuthShell
      title="Join the studio"
      intro="An account lets you book classes, keep track of your pieces and join as a member."
    >
      <RegisterForm next={next} />
    </AuthShell>
  )
}
