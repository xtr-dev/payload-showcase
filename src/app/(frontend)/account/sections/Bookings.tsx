import Link from 'next/link'

import { Badge, ButtonLink, Card, type BadgeTone } from '@/components/ui'
import { formatDate, formatPrice, formatTime } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import type { Booking, User } from '@/payload-types'

const STATUS: Record<Booking['status'], { label: string; tone: BadgeTone }> = {
  pending: { label: 'Awaiting payment', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'neutral' },
}

/** The member's own bookings. Access control guarantees nobody else's are returned. */
export const BookingsSection = async ({ user }: { user: User }) => {
  const payload = await getPayloadClient()
  const { docs: bookings } = await payload.find({
    collection: 'bookings',
    sort: '-createdAt',
    depth: 2,
    limit: 50,
    user,
    overrideAccess: false,
  })

  return (
    <Card as="section" className="p-6" aria-labelledby="bookings-heading">
      <h2 id="bookings-heading" className="text-2xl text-ink">
        My bookings
      </h2>
      {bookings.length === 0 ? (
        <div className="mt-4 text-ink-soft">
          <p>No bookings yet.</p>
          <ButtonLink href="/workshops" size="sm" className="mt-4">
            Find a workshop
          </ButtonLink>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line" data-testid="bookings">
          {bookings.map((b) => {
            const session = typeof b.session === 'object' ? b.session : null
            const workshop = typeof b.workshop === 'object' ? b.workshop : null
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-semibold text-ink">
                    {workshop ? (
                      <Link
                        href={`/workshops/${workshop.slug}`}
                        className="hover:text-clay hover:underline"
                      >
                        {workshop.title}
                      </Link>
                    ) : (
                      'Workshop'
                    )}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {session &&
                      `${formatDate(session.startsAt)}, ${formatTime(session.startsAt)} · `}
                    {formatPrice(b.amount, b.currency ?? 'EUR')} ·{' '}
                    <span className="font-mono">{b.reference}</span>
                  </p>
                </div>
                <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
