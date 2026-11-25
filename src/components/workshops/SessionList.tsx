import { ButtonLink } from '@/components/ui'
import { formatDate, formatTime } from '@/lib/format'
import type { Session } from '@/payload-types'

/** Upcoming sessions of a workshop, each with seat availability and a Book link. */
export const SessionList = ({ sessions }: { sessions: Session[] }) => {
  if (sessions.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line p-6 text-ink-soft">
        No upcoming dates yet. New dates are added every month.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white/70">
      {sessions.map((s) => {
        const seats = s.seatsLeft ?? 0
        const full = seats < 1
        return (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
            data-testid="session"
          >
            <div>
              <p className="font-semibold text-ink">
                <time dateTime={s.startsAt}>{formatDate(s.startsAt)}</time>
              </p>
              <p className="text-sm text-ink-soft">
                {formatTime(s.startsAt)} ·{' '}
                {full ? (
                  <span className="font-semibold text-danger">Fully booked</span>
                ) : seats <= 2 ? (
                  <span className="font-semibold text-warning">Only {seats} left</span>
                ) : (
                  `${seats} seats left`
                )}
              </p>
            </div>
            {full ? (
              <span className="text-sm font-semibold text-ink-soft">Waitlist soon</span>
            ) : (
              <ButtonLink
                href={`/book/${s.id}`}
                size="sm"
                aria-label={`Book ${formatDate(s.startsAt)} at ${formatTime(s.startsAt)}`}
              >
                Book
              </ButtonLink>
            )}
          </li>
        )
      })}
    </ul>
  )
}
