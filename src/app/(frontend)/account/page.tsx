import type { Metadata } from 'next'
import Link from 'next/link'

import { LogoutButton } from '@/components/layout/LogoutButton'
import { Alert, Badge, ButtonLink, Card, Container } from '@/components/ui'
import { requireUser } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { formatPrice } from '@/lib/format'

import { BillingSection } from './sections/Billing'
import { BookingsSection } from './sections/Bookings'
import { NotificationsSection } from './sections/Notifications'
import { OrdersSection } from './sections/Orders'
import { SettingsSection } from './sections/Settings'

export const metadata: Metadata = { title: 'My studio', robots: { index: false } }

const MEMBERSHIP_TONE = {
  active: 'success',
  pending: 'warning',
  cancelled: 'danger',
  none: 'neutral',
} as const

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireUser('/account')
  const params = await searchParams
  const plan = typeof user.membershipPlan === 'object' ? user.membershipPlan : null
  const status = user.membershipStatus ?? 'none'
  const shop = await isEnabled('shop')

  return (
    <Container className="py-12 lg:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-clay uppercase">My studio</p>
          <h1 className="mt-2 text-4xl text-ink sm:text-5xl">
            Welcome back, {user.name.split(' ')[0]}
          </h1>
        </div>
        <div className="flex gap-2">
          {user.role === 'admin' && (
            <ButtonLink href="/admin" variant="outline" size="sm">
              Admin panel
            </ButtonLink>
          )}
          <LogoutButton />
        </div>
      </div>

      {typeof params.booked === 'string' && (
        <Alert tone="success" title="Seat reserved" className="mt-8">
          Booking <strong>{params.booked}</strong> is waiting for payment. You’ll find it below.
        </Alert>
      )}
      {params.membership === 'pending' && (
        <Alert tone="success" title="Membership requested" className="mt-8">
          Your membership starts as soon as the first payment is through.
        </Alert>
      )}

      <div className="mt-10 grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-8">
          <BookingsSection user={user} />
          {shop && <OrdersSection user={user} />}
          <BillingSection user={user} />
          <NotificationsSection user={user} />
        </div>
        <aside className="space-y-8">
          <Card as="section" tone="bisque" className="p-6" aria-labelledby="membership-heading">
            <div className="flex items-center justify-between gap-2">
              <h2 id="membership-heading" className="text-2xl text-ink">
                Membership
              </h2>
              <Badge tone={MEMBERSHIP_TONE[status]}>{status === 'none' ? 'No plan' : status}</Badge>
            </div>
            {plan ? (
              <p className="mt-3 text-ink-soft">
                <span className="font-semibold text-ink">{plan.name}</span> ·{' '}
                {formatPrice(plan.price)}/month
                {user.membershipRenewsAt && status === 'active' && (
                  <>
                    <br />
                    Renews{' '}
                    {new Date(user.membershipRenewsAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                    })}
                  </>
                )}
              </p>
            ) : (
              <p className="mt-3 text-ink-soft">
                Get open-studio time, clay and firings.{' '}
                <Link href="/membership" className="font-semibold text-clay hover:underline">
                  See plans
                </Link>
              </p>
            )}
          </Card>
          <SettingsSection user={user} />
        </aside>
      </div>
    </Container>
  )
}
