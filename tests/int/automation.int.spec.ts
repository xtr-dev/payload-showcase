import http from 'http'
import type { AddressInfo } from 'net'

import {
  createLocalReq,
  type Endpoint,
  type Payload,
  type PayloadRequest,
  type Where,
} from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getRecentRuns, runStudioDigest } from '@/lib/automation'
import type { Booking, User, WorkflowRun } from '@/payload-types'
import { seed, type SeedContext } from '@/seed'
import {
  DEV_WEBHOOK_SECRET,
  KILN_ALERT_THRESHOLD_C,
  KILN_ALERT_WEBHOOK_PATH,
  WORKFLOW_SLUGS,
} from '@/seed/automation'

import { getTestPayload, type TestPayload } from '../helpers/payload'

/**
 * Integration tests for the @xtr-dev/payload-automation integration: each seeded workflow fires
 * (or stays quiet) according to its trigger condition, runs are recorded with step results, the
 * webhook needs its secret, and manual runs are admin-only.
 */

let t: TestPayload
let payload: Payload
let ctx: SeedContext
let mara: User

/** Stands in for the site's mock pager, which needs a running HTTP server. */
let pager: http.Server
const pagerCalls: unknown[] = []

const relId = (v: unknown) => (v && typeof v === 'object' ? (v as { id: number }).id : v)

const workflowId = async (slug: string) => {
  const { docs } = await payload.find({
    collection: 'workflows',
    where: { slug: { equals: slug } },
  })
  return docs[0]!.id
}

const runsOf = async (slug: string): Promise<WorkflowRun[]> => {
  const { docs } = await payload.find({
    collection: 'workflow-runs',
    where: { workflow: { equals: await workflowId(slug) } },
    sort: '-createdAt',
    depth: 0,
    limit: 100,
  })
  return docs
}

/** Mailing's confirmation emails for the booking under test. */
let confirmationEmails: () => Promise<number>
/** Notifications about the booking under test that match `where`. */
let bookingNotifications: (where: Where) => Promise<number>

const latestLogEntry = async () =>
  (await payload.find({ collection: 'studio-log', sort: '-createdAt', limit: 1, depth: 0 })).docs[0]

const findEndpoint = (path: string): Endpoint =>
  payload.config.endpoints.find((e) => e.path === path) as Endpoint

/** Calls the plugin's webhook endpoint the way Payload's REST router would. */
const postWebhook = async (body: unknown, headers: Record<string, string> = {}) => {
  const endpoint = findEndpoint('/automation/webhooks/:webhookPath')
  const req = (await createLocalReq(
    {
      req: {
        headers: new Headers(headers),
        routeParams: { webhookPath: KILN_ALERT_WEBHOOK_PATH },
        url: `http://localhost/api/automation/webhooks/${KILN_ALERT_WEBHOOK_PATH}`,
        json: async () => body,
      } as Partial<PayloadRequest>,
    },
    payload,
  )) as PayloadRequest
  const res = await endpoint.handler(req)
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

beforeAll(async () => {
  pager = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      pagerCalls.push(JSON.parse(raw || 'null'))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ paged: true, onCall: 'Ines (kiln technician)', ticket: 'PG-TEST1' }))
    })
  })
  await new Promise<void>((resolve) => pager.listen(0, '127.0.0.1', resolve))
  process.env.PUBLIC_KILN_PAGER_URL = `http://127.0.0.1:${(pager.address() as AddressInfo).port}/`

  t = await getTestPayload()
  payload = t.payload
  ctx = await seed(payload)
  mara = ctx.members[0]
})

afterAll(async () => {
  await t?.cleanup()
  await new Promise((resolve) => pager?.close(resolve))
})

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('wiring', () => {
  it('seeds the four code-defined workflows as read-only', async () => {
    const { docs } = await payload.find({ collection: 'workflows', limit: 10, depth: 1 })
    expect(docs.map((w) => w.slug).sort()).toEqual(Object.values(WORKFLOW_SLUGS).sort())
    expect(docs.every((w) => w.readOnly === true && w.enabled !== false)).toBe(true)

    const tasks = payload.config.jobs.tasks?.map((task) => task.slug) ?? []
    expect(tasks).toEqual(
      expect.arrayContaining([
        'http-request-step',
        'create-document',
        'read-document',
        'update-document',
        'delete-document',
        'send-email',
      ]),
    )
    // Step outputs are read back from the step's job, so finished jobs must be kept.
    expect(payload.config.jobs.deleteJobOnComplete).toBe(false)
  })

  it("still clears other plugins' completed jobs on each job-runner tick", async () => {
    // Any task outside a workflow run, e.g. a mailing or billing job, behaves the same.
    const job = await payload.jobs.queue({
      task: 'read-document',
      input: { collectionSlug: 'workshops', limit: 1 },
    })
    await payload.jobs.runByID({ id: job.id })
    const kept = await payload.findByID({ collection: 'payload-jobs', id: job.id })
    expect(kept.completedAt).toBeTruthy()

    // Tests switch the cron off (DISABLE_JOBS_AUTORUN), but the clean-up still runs first.
    expect(await payload.config.jobs.shouldAutoRun?.(payload)).toBe(false)
    const left = await payload.count({
      collection: 'payload-jobs',
      where: { id: { equals: job.id } },
    })
    expect(left.totalDocs).toBe(0)
  })

  it('keeps seeded workflows locked through the API, even for admins', async () => {
    await expect(
      payload.update({
        collection: 'workflows',
        id: await workflowId(WORKFLOW_SLUGS.bookingConfirmed),
        data: { name: 'Hijacked' },
        user: ctx.admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})

describe('Booking confirmed (collection hook)', () => {
  let booking: Booking

  beforeAll(async () => {
    booking = ctx.bookings.find((b) => relId(b.member) === mara.id && b.status === 'pending')!
    confirmationEmails = async () =>
      (
        await payload.count({
          collection: 'emails',
          where: {
            and: [
              { booking: { equals: booking.id } },
              { templateSlug: { equals: 'booking-confirmation' } },
            ],
          },
        })
      ).totalDocs
    bookingNotifications = async (where) =>
      (
        await payload.count({
          collection: 'notifications',
          where: { and: [{ booking: { equals: booking.id } }, where] },
        })
      ).totalDocs
  })

  it('does not run while the booking stays pending', async () => {
    await payload.update({ collection: 'bookings', id: booking.id, data: { notes: 'Left-handed' } })
    expect(await runsOf(WORKFLOW_SLUGS.bookingConfirmed)).toHaveLength(0)
  })

  it('runs every step when the booking is confirmed and records the run', async () => {
    const sendEmail = vi.spyOn(payload, 'sendEmail')
    await payload.update({ collection: 'bookings', id: booking.id, data: { status: 'paid' } })

    const runs = await runsOf(WORKFLOW_SLUGS.bookingConfirmed)
    expect(runs).toHaveLength(1)
    const [run] = runs
    expect(run.status).toBe('completed')
    expect(run.stepResults?.map((s) => [s.stepName, s.status])).toEqual([
      ['Read session', 'succeeded'],
      ['Read workshop', 'succeeded'],
      ['Find confirmation email', 'succeeded'],
      ['Find confirmation notification', 'succeeded'],
      ['Find earlier tips', 'succeeded'],
      ['Send what-to-bring tips', 'succeeded'],
      ['Write studio log', 'succeeded'],
    ])

    // The workflow sends no email of its own: mailing's single confirmation is the only one.
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await confirmationEmails()).toBe(1)
    expect(await bookingNotifications({ event: { equals: 'booking-confirmed' } })).toBe(1)

    // Later steps used the earlier steps' outputs (JSONata over steps.<name>.output).
    const session = ctx.sessions.find((s) => s.id === relId(booking.session))!
    const workshop = ctx.workshops.find((w) => w.id === relId(session.workshop))!
    const { docs: tips } = await payload.find({
      collection: 'notifications',
      where: {
        and: [{ booking: { equals: booking.id } }, { channel: { equals: 'class-reminders' } }],
      },
      depth: 0,
    })
    expect(tips).toHaveLength(1)
    expect(tips[0].title).toBe(`Getting ready for ${workshop.title}`)
    expect(relId(tips[0].recipient)).toBe(mara.id)
    expect(JSON.stringify(tips[0].message)).toContain('Your class starts ')

    const entry = await latestLogEntry()
    expect(entry.title).toBe(`Seat confirmed: ${workshop.title}`)
    expect(entry.source).toBe('booking')
    expect(relId(entry.booking)).toBe(booking.id)
    expect(entry.message).toContain('Confirmation email: queued by mailing.')
    expect(entry.message).toContain('Inbox message: sent by notifications.')
    expect(entry.message).toContain('What-to-bring tips: sent.')
    // The public message names no member and no booking reference.
    expect(entry.message).not.toContain(mara.name)
    expect(entry.message).not.toContain(booking.reference)

    // The step jobs kept for their output are cleaned up once the run has finished.
    const jobs = await payload.count({
      collection: 'payload-jobs',
      where: { automationWorkflowRun: { equals: run.id } },
    })
    expect(jobs.totalDocs).toBe(0)
  })

  it('does not run again when a paid booking is saved or cancelled', async () => {
    await payload.update({ collection: 'bookings', id: booking.id, data: { notes: 'Bring apron' } })
    await payload.update({ collection: 'bookings', id: booking.id, data: { status: 'cancelled' } })
    expect(await runsOf(WORKFLOW_SLUGS.bookingConfirmed)).toHaveLength(1)
  })

  it('skips the tips when a booking is paid a second time, and duplicates nothing', async () => {
    await payload.update({ collection: 'bookings', id: booking.id, data: { status: 'paid' } })
    const [run] = await runsOf(WORKFLOW_SLUGS.bookingConfirmed)
    expect(run.status).toBe('completed')
    expect(run.stepResults?.find((s) => s.stepName === 'Send what-to-bring tips')?.status).toBe(
      'skipped',
    )
    expect((await latestLogEntry()).message).toContain('What-to-bring tips: already sent earlier.')

    expect(await confirmationEmails()).toBe(1)
    expect(await bookingNotifications({ event: { equals: 'booking-confirmed' } })).toBe(1)
    expect(await bookingNotifications({ channel: { equals: 'class-reminders' } })).toBe(1)
  })
})

describe('Kiln temperature alert (webhook)', () => {
  const alert = { kiln: 'Big Bertha', temperatureC: KILN_ALERT_THRESHOLD_C + 30 }

  it('rejects calls without the secret or with a wrong one', async () => {
    expect((await postWebhook(alert)).status).toBe(401)
    expect((await postWebhook(alert, { 'x-webhook-secret': 'wrong-secret' })).status).toBe(401)
    expect((await postWebhook(alert, { authorization: 'Bearer wrong-secret' })).status).toBe(401)
    expect(await runsOf(WORKFLOW_SLUGS.kilnAlert)).toHaveLength(0)
    expect(pagerCalls).toHaveLength(0)
  })

  it('skips readings below the alert threshold', async () => {
    const res = await postWebhook(
      { kiln: 'Big Bertha', temperatureC: 900 },
      { 'x-webhook-secret': DEV_WEBHOOK_SECRET },
    )
    expect(res.status).toBe(200)
    expect(res.json.workflows).toEqual([expect.objectContaining({ status: 'skipped' })])
    expect(await runsOf(WORKFLOW_SLUGS.kilnAlert)).toHaveLength(0)
  })

  it('pages the technician over HTTP and logs the alert with the pager ticket', async () => {
    const res = await postWebhook(alert, { authorization: `Bearer ${DEV_WEBHOOK_SECRET}` })
    expect(res.status).toBe(200)
    expect(res.json.workflows).toEqual([expect.objectContaining({ status: 'triggered' })])

    expect(pagerCalls).toEqual([alert])
    const [run] = await runsOf(WORKFLOW_SLUGS.kilnAlert)
    expect(run.status).toBe('completed')
    expect(run.stepResults?.map((s) => s.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])

    // A Studio news broadcast (no recipient) through the notifications collection.
    const { docs: news } = await payload.find({
      collection: 'notifications',
      where: { channel: { equals: 'studio-news' } },
      sort: '-createdAt',
      limit: 1,
      depth: 0,
    })
    expect(news[0]?.title).toBe('Kiln update: Big Bertha is running hot')
    expect(news[0]?.recipient ?? null).toBeNull()

    const entry = await latestLogEntry()
    expect(entry.title).toBe(`Kiln alert: Big Bertha at ${alert.temperatureC} °C`)
    expect(entry.message).toBe('Paged Ines (kiln technician) (ticket PG-TEST1).')
    expect(entry.severity).toBe('warning')

    // The stored run never carries the secret or its hash.
    expect(JSON.stringify(run)).not.toContain(DEV_WEBHOOK_SECRET)
    expect(JSON.stringify(run)).not.toContain('webhookSecretHash')
  })

  it('serves a mock pager that answers like a paging API', async () => {
    const endpoint = findEndpoint('/studio/kiln-pager')
    const req = (await createLocalReq(
      { req: { json: async () => ({ kiln: 'Little Kiln' }) } as Partial<PayloadRequest> },
      payload,
    )) as PayloadRequest
    const body = await (await endpoint.handler(req)).json()
    expect(body).toMatchObject({
      paged: true,
      kiln: 'Little Kiln',
      ticket: expect.stringMatching(/^PG-/),
    })
  })
})

describe('Opening hours changed (global hook)', () => {
  it('stays quiet when other settings change', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { tagline: 'Clay, salt and sea air' },
    })
    expect(await runsOf(WORKFLOW_SLUGS.openingHours)).toHaveLength(0)
  })

  it('logs the new opening hours when they change', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: {
        openingHours: [
          { days: 'Wed – Sun', hours: '11:00 – 18:00' },
          { days: 'Mon – Tue', hours: 'Closed' },
        ],
      },
    })
    const runs = await runsOf(WORKFLOW_SLUGS.openingHours)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('completed')

    const entry = await latestLogEntry()
    expect(entry.source).toBe('settings')
    expect(entry.message).toBe('Now open: Wed – Sun 11:00 – 18:00 · Mon – Tue Closed')
  })
})

describe('Studio digest (manual run)', () => {
  it('is admin-only', async () => {
    await expect(runStudioDigest(payload, null)).rejects.toThrow()
    await expect(runStudioDigest(payload, mara)).rejects.toThrow()
    expect(await runsOf(WORKFLOW_SLUGS.studioDigest)).toHaveLength(0)
  })

  it('runs from server code for an admin and returns the finished run', async () => {
    const sendEmail = vi.spyOn(payload, 'sendEmail')
    const paid = await payload.count({
      collection: 'bookings',
      where: { status: { equals: 'paid' } },
    })

    const summary = await runStudioDigest(payload, ctx.admin)
    expect(summary.status).toBe('completed')
    expect(summary.workflowSlug).toBe(WORKFLOW_SLUGS.studioDigest)
    expect(summary.steps.map((s) => s.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ])

    const entry = await latestLogEntry()
    expect(entry.source).toBe('manual')
    expect(entry.message).toMatch(new RegExp(`^${paid.totalDocs} confirmed bookings and \\d+`))
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ctx.admin.email, subject: 'Kiln & Co. studio digest' }),
    )
  })
})

describe('run history', () => {
  it('records runs that only admins can read through the API', async () => {
    await expect(
      payload.find({ collection: 'workflow-runs', user: mara, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(
      payload.find({ collection: 'workflow-runs', overrideAccess: false }),
    ).rejects.toThrow()
    const asAdmin = await payload.find({
      collection: 'workflow-runs',
      user: ctx.admin,
      overrideAccess: false,
    })
    expect(asAdmin.totalDocs).toBe(5)
  })

  it('summarises runs for the public without trigger data, step data or errors', async () => {
    const runs = await getRecentRuns(payload)
    expect(runs.map((r) => r.workflowSlug)).toEqual([
      WORKFLOW_SLUGS.studioDigest,
      WORKFLOW_SLUGS.openingHours,
      WORKFLOW_SLUGS.kilnAlert,
      WORKFLOW_SLUGS.bookingConfirmed,
      WORKFLOW_SLUGS.bookingConfirmed,
    ])
    const serialized = JSON.stringify(runs)
    expect(serialized).not.toContain(mara.email)
    expect(serialized).not.toContain('triggerData')
    expect(runs.every((r) => r.error === undefined)).toBe(true)
  })

  it('lets the public read the studio log but not which booking an entry is about', async () => {
    const { docs } = await payload.find({ collection: 'studio-log', overrideAccess: false })
    expect(docs.length).toBe(5)
    expect(docs.every((d) => d.booking === undefined)).toBe(true)
    await expect(
      payload.create({
        collection: 'studio-log',
        data: { title: 'Spam', source: 'manual', severity: 'info' },
        user: mara,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('clears the run history and studio log on a reset seed', async () => {
    await seed(payload)
    expect((await payload.count({ collection: 'workflow-runs' })).totalDocs).toBe(0)
    expect((await payload.count({ collection: 'studio-log' })).totalDocs).toBe(0)
    // The workflows are code and survive the reset.
    expect((await payload.count({ collection: 'workflows' })).totalDocs).toBe(4)
  })
})
