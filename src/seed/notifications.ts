import type { Payload } from 'payload'

import { formatDate, formatTime } from '@/lib/format'
import { broadcast, notifyMember } from '@/lib/notifications'
import { richText } from '@/lib/richtext'

import type { SeedContext } from './types'

const COLLECTIONS = ['notification-reads', 'notifications', 'push-subscriptions'] as const

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

/**
 * Seed data for the Notifications integration: studio broadcasts written by the admin (with rich
 * text), and per member a booking confirmation for each booking plus a class reminder.
 *
 * Mara starts with some unread notifications; Jonas has read one broadcast, which shows that
 * broadcast read state is per member.
 */
export const seedNotifications = async (
  payload: Payload,
  ctx: SeedContext,
  { reset }: { reset: boolean },
): Promise<void> => {
  if (reset) {
    for (const collection of COLLECTIONS) {
      await payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true })
    }
  }

  // Timestamps are backdated so the inbox has a believable order (newest first).
  const backdate = (id: number, hours: number) =>
    payload.update({
      collection: 'notifications',
      id,
      data: { createdAt: hoursAgo(hours) },
      overrideAccess: true,
    })

  const firing = await broadcast(payload, {
    title: 'Kiln firing schedule changed',
    channel: 'studio-news',
    message: richText(
      'The big gas kiln is being serviced, so this week’s glaze firing moves from Thursday to Saturday.',
      { h: 'What this means for you' },
      {
        ul: [
          'Bisqueware on the “to glaze” shelf by Friday 17:00 goes in the Saturday firing.',
          'Pieces are ready for pick-up from Tuesday.',
          'The electric kiln runs as usual for test tiles.',
        ],
      },
    ),
  })
  await backdate(firing.id, 30)

  const openStudio = await broadcast(payload, {
    title: 'Open studio hours this weekend',
    channel: 'studio-news',
    message:
      'The studio is open to members on Saturday and Sunday from 10:00 to 16:00.\n\nBring your own apron; clay and tools are on us.',
  })
  await backdate(openStudio.id, 6)

  const glazeLab = await broadcast(payload, {
    title: 'New: glaze mixing demo before class',
    channel: 'class-reminders',
    message:
      'From next week, Glaze Lab starts with a 15-minute mixing demo. Arrive a little early to catch it.',
  })
  await backdate(glazeLab.id, 50)

  for (const [index, member] of ctx.members.entries()) {
    const own = ctx.bookings.filter(
      (b) => (typeof b.member === 'object' ? b.member?.id : b.member) === member.id,
    )
    for (const [n, booking] of own.entries()) {
      const sessionId = typeof booking.session === 'object' ? booking.session.id : booking.session
      const session = ctx.sessions.find((s) => s.id === sessionId)
      const workshopId = session
        ? typeof session.workshop === 'object'
          ? session.workshop.id
          : session.workshop
        : null
      const workshop = ctx.workshops.find((w) => w.id === workshopId)
      if (!session || !workshop) continue
      const when = `${formatDate(session.startsAt)} at ${formatTime(session.startsAt)}`

      const confirmed = await notifyMember(payload, member.id, {
        title: booking.status === 'paid' ? 'Your booking is confirmed' : 'Your seat is reserved',
        channel: 'bookings',
        message:
          booking.status === 'paid'
            ? `See you at ${workshop.title} on ${when}. Your booking reference is ${booking.reference}.`
            : `We’re holding a seat for you at ${workshop.title} on ${when}. Complete the payment to confirm booking ${booking.reference}.`,
      })
      await backdate(confirmed.id, 72 - n * 10)

      if (n === 0) {
        const reminder = await notifyMember(payload, member.id, {
          title: `Class reminder: ${workshop.title}`,
          channel: 'class-reminders',
          message: `Your class is on ${when}. Wear clothes that can get muddy and tie long hair back.`,
        })
        await backdate(reminder.id, 2)
      }

      // The second member has already read their booking confirmation.
      if (index === 1) {
        await payload.update({
          collection: 'notifications',
          id: confirmed.id,
          data: { isRead: true, readAt: hoursAgo(60) },
          overrideAccess: true,
        })
      }
    }
  }

  // Per-member broadcast read state: Jonas has read the firing schedule change, Mara hasn't.
  const jonas = ctx.members[1]
  if (jonas) {
    await payload.create({
      collection: 'notification-reads',
      data: { user: jonas.id, notification: firing.id },
      overrideAccess: true,
    })
  }
}
