import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BookingFlowV2 } from '@/components/booking/BookingFlowV2'
import { BookingForm } from '@/components/booking/BookingForm'
import { Alert, Card, Container, MediaImage } from '@/components/ui'
import { requireUser } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { asMedia, formatDate, formatDuration, formatPrice, formatTime } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'

export const metadata: Metadata = { title: 'Book a seat', robots: { index: false } }

type Params = Promise<{ sessionId: string }>

export default async function BookPage({ params }: { params: Params }) {
  const { sessionId } = await params
  const id = Number(sessionId)
  if (!Number.isInteger(id)) notFound()

  const user = await requireUser(`/book/${id}`)
  const payload = await getPayloadClient()
  const session = await payload
    .findByID({ collection: 'sessions', id, depth: 2, overrideAccess: false })
    .catch(() => null)
  const workshop = session && typeof session.workshop === 'object' ? session.workshop : null
  if (!session || !workshop) notFound()

  const newFlow = await isEnabled('new-booking-flow', { userId: user.id })
  const Flow = newFlow ? BookingFlowV2 : BookingForm
  const seats = session.seatsLeft ?? 0
  const bookable =
    session.status === 'scheduled' && seats > 0 && new Date(session.startsAt) > new Date()

  return (
    <Container className="py-12 lg:py-16">
      <nav aria-label="Breadcrumb" className="mb-8 text-sm">
        <ol className="flex flex-wrap gap-2 text-ink-soft">
          <li>
            <Link href="/workshops" className="font-medium text-clay hover:underline">
              Workshops
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link
              href={`/workshops/${workshop.slug}`}
              className="font-medium text-clay hover:underline"
            >
              {workshop.title}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="font-medium text-ink">
            Book
          </li>
        </ol>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
        <Card tone="bisque" className="overflow-hidden">
          <div className="aspect-[16/9]">
            <MediaImage media={asMedia(workshop.images?.[0])} priority />
          </div>
          <div className="space-y-4 p-6 sm:p-8">
            <p className="text-sm font-semibold tracking-[0.14em] text-clay uppercase">
              Your booking
            </p>
            <h1 className="text-3xl text-ink sm:text-4xl">{workshop.title}</h1>
            <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4">
              <div>
                <dt className="text-sm text-ink-soft">Date</dt>
                <dd className="font-semibold">{formatDate(session.startsAt)}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink-soft">Time</dt>
                <dd className="font-semibold">
                  {formatTime(session.startsAt)} · {formatDuration(workshop.duration)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ink-soft">Seats left</dt>
                <dd className="font-semibold">{seats}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink-soft">Price</dt>
                <dd className="font-display text-2xl font-semibold text-clay">
                  {formatPrice(workshop.price)}
                </dd>
              </div>
            </dl>
          </div>
        </Card>

        <div>
          <h2 className="text-2xl text-ink">Booking for {user.name}</h2>
          <p className="mt-2 mb-6 text-ink-soft">
            Signed in as {user.email}. You will find this booking under{' '}
            <Link href="/account" className="font-medium text-clay underline underline-offset-4">
              My studio
            </Link>
            .
          </p>
          {bookable ? (
            <Flow sessionId={session.id} priceLabel={formatPrice(workshop.price)} />
          ) : (
            <Alert tone="warning" title="This date can’t be booked">
              It is fully booked, cancelled or already in the past.{' '}
              <Link href={`/workshops/${workshop.slug}`} className="underline">
                See other dates
              </Link>
              .
            </Alert>
          )}
        </div>
      </div>
    </Container>
  )
}
