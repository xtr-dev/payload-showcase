import { createLocalReq, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  broadcast,
  countUnread,
  getFollowedChannels,
  getInbox,
  notifyMember,
  setFollowedChannels,
} from '@/lib/notifications'
import { richText } from '@/lib/richtext'
import type { User } from '@/payload-types'
import { seed, type SeedContext } from '@/seed'

import { getTestPayload, type TestPayload } from '../helpers/payload'

let t: TestPayload
let payload: Payload
let ctx: SeedContext
let mara: User
let jonas: User

const relId = (v: unknown) => (v && typeof v === 'object' ? (v as { id: number }).id : (v ?? null))

/** Whether a rich-text message contains `text` (in any text node). */
const mentions = (message: unknown, text: string) => JSON.stringify(message).includes(text)

/**
 * Calls the plugin's `POST`/`DELETE /api/notifications/:id/read` endpoint as `user`, the way the
 * inbox buttons do, and returns the HTTP status.
 */
const setRead = async (user: User, id: number, read: boolean): Promise<number> => {
  const endpoint = (payload.collections.notifications.config.endpoints || []).find(
    (e) => e.path === '/:id/read' && e.method === (read ? 'post' : 'delete'),
  )
  if (!endpoint) throw new Error('The notifications read endpoint is not registered')
  const req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)
  req.routeParams = { id }
  const res = await endpoint.handler(req)
  return res.status
}

/**
 * Calls the plugin's `/api/channel-subscriptions/me` endpoints as `user`: `GET /me` lists the
 * channels with the user's state, `POST`/`DELETE /me/:channel` subscribes or opts out.
 */
const channelEndpoint = async (
  user: User,
  method: 'get' | 'post' | 'delete',
  channel?: string,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const endpoint = (payload.collections['channel-subscriptions'].config.endpoints || []).find(
    (e) => e.path === (channel ? '/me/:channel' : '/me') && e.method === method,
  )
  if (!endpoint) throw new Error('The channel subscription endpoint is not registered')
  const req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)
  req.routeParams = channel ? { channel } : {}
  const res = await endpoint.handler(req)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** Re-reads a user, so preference changes made during a test are picked up. */
const fresh = (user: User) => payload.findByID({ collection: 'users', id: user.id })

beforeAll(async () => {
  t = await getTestPayload()
  payload = t.payload
  ctx = await seed(payload)
  ;[mara, jonas] = ctx.members
})

afterAll(async () => {
  await t?.cleanup()
})

describe('Notifications (payload-notifications)', () => {
  it('is wired into the Payload config with the studio channels and web push off', () => {
    const slugs = payload.config.collections.map((c) => c.slug)
    expect(slugs).toEqual(
      expect.arrayContaining([
        'notifications',
        'push-subscriptions',
        'notification-reads',
        'channel-subscriptions',
      ]),
    )
    const channel = payload.collections.notifications.config.fields.find(
      (f) => 'name' in f && f.name === 'channel',
    )
    expect(channel && 'options' in channel && channel.options).toEqual([
      { label: 'Bookings', value: 'bookings' },
      { label: 'Orders', value: 'orders' },
      { label: 'Class reminders', value: 'class-reminders' },
      { label: 'Studio news', value: 'studio-news' },
    ])
    // Without VAPID keys the plugin registers no push endpoints.
    expect(payload.config.endpoints.some((e) => e.path.startsWith('/push-notifications'))).toBe(
      false,
    )
  })

  it('seeds personal notifications per member and rich-text broadcasts', async () => {
    const all = await payload.find({ collection: 'notifications', pagination: false, depth: 0 })
    const broadcasts = all.docs.filter((n) => n.audience === 'broadcast')
    expect(broadcasts.map((n) => n.title)).toContain('Kiln firing schedule changed')
    expect(broadcasts.every((n) => relId(n.recipient) === null)).toBe(true)
    for (const member of ctx.members) {
      expect(all.docs.some((n) => relId(n.recipient) === member.id && n.audience === 'user')).toBe(
        true,
      )
    }
    const firing = broadcasts.find((n) => n.title === 'Kiln firing schedule changed')!
    expect(mentions(firing.message, 'What this means for you')).toBe(true)
  })

  it('shows a member only their own notifications and broadcasts', async () => {
    // Directly through the collection, with the member's own access rights.
    const { docs } = await payload.find({
      collection: 'notifications',
      pagination: false,
      depth: 0,
      user: mara,
      overrideAccess: false,
    })
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((n) => relId(n.recipient) === mara.id || n.audience === 'broadcast')).toBe(
      true,
    )

    const inbox = await getInbox(payload, mara)
    const personal = inbox.filter((i) => i.personal)
    expect(personal.map((i) => i.notification.title)).toContain('Booking confirmed')
    expect(personal.every((i) => relId(i.notification.recipient) === mara.id)).toBe(true)
    expect(inbox.some((i) => !i.personal)).toBe(true)

    const jonasOnly = (await getInbox(payload, jonas)).filter((i) => i.personal)
    const maraIds = new Set(inbox.map((i) => i.notification.id))
    expect(jonasOnly.some((i) => maraIds.has(i.notification.id))).toBe(false)
  })

  it('marks personal notifications and broadcasts as read per member', async () => {
    const before = await countUnread(payload, mara)
    const inbox = await getInbox(payload, mara)
    const personal = inbox.find((i) => i.personal && !i.read)!
    const firing = inbox.find((i) => i.notification.title === 'Kiln firing schedule changed')!
    const openStudio = inbox.find((i) => i.notification.title === 'Open studio hours this weekend')!
    expect(firing.read).toBe(false)

    expect(await setRead(mara, personal.notification.id, true)).toBe(200)
    const stored = await payload.findByID({
      collection: 'notifications',
      id: personal.notification.id,
    })
    expect(stored.isRead).toBe(true)
    expect(stored.readAt).toBeTruthy()

    expect(await setRead(mara, openStudio.notification.id, true)).toBe(200)
    // Marking twice is harmless.
    expect(await setRead(mara, openStudio.notification.id, true)).toBe(200)
    expect(await countUnread(payload, mara)).toBe(before - 2)

    // The broadcast is read for Mara only: the plugin's shared flag stays untouched, and Jonas
    // (who had already read the firing change, but not this one) still sees it as unread.
    const sharedFlag = await payload.findByID({
      collection: 'notifications',
      id: openStudio.notification.id,
    })
    expect(sharedFlag.isRead).toBe(false)
    const jonasView = (await getInbox(payload, jonas)).find(
      (i) => i.notification.id === openStudio.notification.id,
    )!
    expect(jonasView.read).toBe(false)
    expect(
      (await getInbox(payload, jonas)).find((i) => i.notification.id === firing.notification.id)!
        .read,
    ).toBe(true)

    // Marking unread again is per member too.
    expect(await setRead(mara, openStudio.notification.id, false)).toBe(200)
    expect(await countUnread(payload, mara)).toBe(before - 1)

    for (const item of (await getInbox(payload, mara)).filter((i) => !i.read)) {
      expect(await setRead(mara, item.notification.id, true)).toBe(200)
    }
    expect(await countUnread(payload, mara)).toBe(0)

    // Nobody can change another member's personal read state.
    const jonasPersonal = (await getInbox(payload, jonas)).find((i) => i.personal)!
    expect(await setRead(mara, jonasPersonal.notification.id, true)).toBe(404)
  })

  it('does not let members flip the shared read flag of a broadcast', async () => {
    const [b] = (await getInbox(payload, jonas)).filter((i) => !i.personal)
    await expect(
      payload.update({
        collection: 'notifications',
        id: b.notification.id,
        data: { isRead: true },
        user: jonas,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/not allowed|not found/i)
  })

  it('targets broadcasts by channel and lets members pick their channels', async () => {
    const reminder = await broadcast(payload, {
      title: 'Glaze Lab moves to studio 2',
      channel: 'class-reminders',
      message: 'Same time, different room.',
    })
    const news = await broadcast(payload, {
      title: 'Summer opening hours',
      channel: 'studio-news',
      message: 'Open until 21:00 in July.',
    })

    // Nobody chose yet, so everyone follows every channel and no row is stored.
    expect(await getFollowedChannels(payload, mara)).toEqual(['class-reminders', 'studio-news'])
    expect((await payload.count({ collection: 'channel-subscriptions' })).totalDocs).toBe(0)

    // Mara follows class reminders only (what "Save channels" in the account settings stores).
    await setFollowedChannels(payload, mara, ['class-reminders'])
    expect(await getFollowedChannels(payload, mara)).toEqual(['class-reminders'])
    const maraInbox = (await getInbox(payload, await fresh(mara))).map((i) => i.notification)
    expect(maraInbox.map((n) => n.id)).toContain(reminder.id)
    expect(maraInbox.map((n) => n.id)).not.toContain(news.id)
    expect(maraInbox.some((n) => n.channel === 'studio-news' && relId(n.recipient) === null)).toBe(
      false,
    )
    // Personal notifications are always delivered, whatever the channel preferences.
    expect(maraInbox.some((n) => n.title === 'Booking confirmed')).toBe(true)

    // Jonas still follows every channel (the default).
    const jonasInbox = (await getInbox(payload, await fresh(jonas))).map((i) => i.notification.id)
    expect(jonasInbox).toEqual(expect.arrayContaining([reminder.id, news.id]))

    expect(news.audience).toBe('broadcast')

    // The plugin's REST endpoints show the same choice, and only ever act on the caller.
    const listed = await channelEndpoint(mara, 'get')
    expect(listed.status).toBe(200)
    expect(listed.body.channels).toEqual([
      expect.objectContaining({ id: 'bookings', subscribed: true }),
      expect.objectContaining({ id: 'orders', subscribed: true }),
      expect.objectContaining({ id: 'class-reminders', subscribed: true }),
      expect.objectContaining({ id: 'studio-news', subscribed: false }),
    ])
    expect((await channelEndpoint(mara, 'post', 'kiln-gossip')).status).toBe(404)

    // Opting back in through the endpoint brings the broadcast back into the inbox.
    expect(await channelEndpoint(mara, 'post', 'studio-news')).toEqual({
      status: 200,
      body: { channel: 'studio-news', subscribed: true },
    })
    expect((await getInbox(payload, mara)).map((i) => i.notification.id)).toContain(news.id)
    expect(await getFollowedChannels(payload, jonas)).toEqual(['class-reminders', 'studio-news'])

    // One row per member and channel, and a member reads only their own rows.
    const maraRows = await payload.find({
      collection: 'channel-subscriptions',
      user: mara,
      overrideAccess: false,
      depth: 0,
    })
    expect(maraRows.docs.map((d) => [relId(d.user), d.channel, d.subscribed]).sort()).toEqual([
      [mara.id, 'class-reminders', true],
      [mara.id, 'studio-news', true],
    ])
    const jonasRows = await payload.find({
      collection: 'channel-subscriptions',
      user: jonas,
      overrideAccess: false,
    })
    expect(jonasRows.totalDocs).toBe(0)
  })

  it('notifies the member once when a booking is paid, and when it is refunded', async () => {
    const booked = new Set(
      ctx.bookings.filter((b) => relId(b.member) === jonas.id).map((b) => relId(b.session)),
    )
    const session = ctx.sessions.find(
      (s) => !booked.has(s.id) && new Date(s.startsAt) > new Date() && (s.seatsLeft ?? 1) > 0,
    )!
    const booking = await payload.create({
      collection: 'bookings',
      data: { session: session.id, member: jonas.id, status: 'pending' },
      user: jonas,
      overrideAccess: false,
    })
    const about = async () =>
      (
        await payload.find({
          collection: 'notifications',
          // The Bookings channel only: automation adds its own class-prep tips on another channel.
          where: { booking: { equals: booking.id }, channel: { equals: 'bookings' } },
          sort: 'createdAt',
          depth: 0,
        })
      ).docs
    expect(await about()).toHaveLength(0)

    const setStatus = (status: 'paid' | 'refunded' | 'pending') =>
      payload.update({ collection: 'bookings', id: booking.id, data: { status } })

    await setStatus('paid')
    let docs = await about()
    expect(docs.map((n) => [n.title, n.event, n.channel, relId(n.recipient)])).toEqual([
      ['Booking confirmed', 'booking-confirmed', 'bookings', jonas.id],
    ])
    expect(mentions(docs[0].message, booking.reference!)).toBe(true)
    // Saving the booking again without a status change sends nothing.
    await payload.update({ collection: 'bookings', id: booking.id, data: { notes: 'Apron' } })
    expect(await about()).toHaveLength(1)

    await setStatus('refunded')
    docs = await about()
    expect(docs.map((n) => n.title)).toEqual(['Booking confirmed', 'Booking refunded'])
    expect(mentions(docs[1].message, 'refunded')).toBe(true)

    // Paid again (e.g. an admin correction): neither notification is repeated.
    await setStatus('pending')
    await setStatus('paid')
    await setStatus('refunded')
    expect(await about()).toHaveLength(2)

    // The member sees both in their inbox, on the Bookings channel.
    const inbox = await getInbox(payload, await fresh(jonas))
    expect(
      inbox.filter(
        (i) =>
          relId(i.notification.booking) === booking.id && i.notification.channel === 'bookings',
      ),
    ).toHaveLength(2)
  })

  it('sends personal notifications with notifyMember', async () => {
    const doc = await notifyMember(payload, jonas.id, {
      title: 'Your booking is confirmed',
      message: 'See you Saturday.\n\nBring an apron.',
    })
    expect(relId(doc.recipient)).toBe(jonas.id)
    expect(doc.channel).toBe('bookings')
    expect(doc.audience).toBe('user')
    expect(mentions(doc.message, 'See you Saturday.')).toBe(true)
    expect(mentions(doc.message, 'Bring an apron.')).toBe(true)

    const jonasInbox = await getInbox(payload, await fresh(jonas))
    expect(jonasInbox[0].notification.id).toBe(doc.id)
    const maraInbox = await getInbox(payload, await fresh(mara))
    expect(maraInbox.some((i) => i.notification.id === doc.id)).toBe(false)
  })

  it('does not let non-admins create, edit or delete notification content', async () => {
    await expect(
      payload.create({
        collection: 'notifications',
        data: {
          title: 'Free clay for everyone',
          message: richText('Come and get it.'),
        },
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/not allowed/i)

    const own = (await getInbox(payload, mara)).find((i) => i.personal)!.notification
    const updated = await payload.update({
      collection: 'notifications',
      id: own.id,
      data: { title: 'Edited by Mara', recipient: jonas.id, isRead: false },
      user: mara,
      overrideAccess: false,
    })
    // The plugin's field access keeps content admin-only; only the read flag changes.
    expect(updated.title).toBe(own.title)
    expect(relId(updated.recipient)).toBe(mara.id)
    expect(updated.isRead).toBe(false)

    // The same goes for the fields the site adds (`booking`, `event`): they are not listed in
    // the plugin's `recipientEditableFields`, so a recipient's change to them is dropped.
    const confirmed = (await getInbox(payload, mara)).find(
      (i) => i.notification.event === 'booking-confirmed',
    )!.notification
    const tampered = await payload.update({
      collection: 'notifications',
      id: confirmed.id,
      data: { event: 'booking-refunded', booking: null, isRead: true },
      user: mara,
      overrideAccess: false,
      depth: 0,
    })
    expect(tampered.event).toBe('booking-confirmed')
    expect(relId(tampered.booking)).toBe(relId(confirmed.booking))
    expect(tampered.isRead).toBe(true)

    const jonasOwn = (await getInbox(payload, jonas)).find((i) => i.personal)!.notification
    await expect(
      payload.update({
        collection: 'notifications',
        id: jonasOwn.id,
        data: { isRead: true },
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.delete({
        collection: 'notifications',
        id: own.id,
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    // Admins can edit content.
    const byAdmin = await payload.update({
      collection: 'notifications',
      id: own.id,
      data: { title: 'Edited by staff' },
      user: ctx.admin,
      overrideAccess: false,
    })
    expect(byAdmin.title).toBe('Edited by staff')
  })

  it('keeps push subscriptions admin-only while web push is off', async () => {
    await expect(
      payload.create({
        collection: 'push-subscriptions',
        data: { user: mara.id, endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a' },
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/not allowed/i)
  })

  it("removes a deleted member's notifications instead of turning them into broadcasts", async () => {
    const eve = await payload.create({
      collection: 'users',
      data: { name: 'Eve', email: 'eve-notify@kiln.test', password: 'password123', role: 'member' },
    })
    const doc = await notifyMember(payload, eve.id, { title: 'Hi Eve', message: 'Welcome.' })
    await payload.delete({ collection: 'users', id: eve.id })

    const found = await payload.find({
      collection: 'notifications',
      where: { id: { equals: doc.id } },
      depth: 0,
    })
    expect(found.totalDocs).toBe(0)
    expect((await getInbox(payload, jonas)).some((i) => i.notification.id === doc.id)).toBe(false)
  })
})
