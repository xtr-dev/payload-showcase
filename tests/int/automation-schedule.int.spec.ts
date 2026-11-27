import {
  runScheduledTriggers,
  SCHEDULED_TRIGGERS_TASK_SLUG,
} from '@xtr-dev/payload-automation/server'
import { Cron } from 'croner'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getScheduleStatus } from '@/lib/automation'
import type { AutomationTrigger, Workflow } from '@/payload-types'
import { seed, type SeedContext } from '@/seed'
import {
  AUTOMATION_QUEUE,
  MORNING_REPORT_SCHEDULE,
  MORNING_REPORT_TIMEZONE,
  WORKFLOW_SLUGS,
} from '@/seed/automation'

import { getTestPayload, type TestPayload } from '../helpers/payload'

/**
 * Integration tests for the scheduled "Morning kiln-room report" workflow: it is seeded with its
 * cron and the studio timezone, the scheduler task runs on a queue the site's job runner covers,
 * and `runScheduledTriggers` with a controlled `now` fires it once at 07:00 studio time, writing
 * the report to the studio log and emailing the admins.
 */

let t: TestPayload
let payload: Payload
let ctx: SeedContext
let workflow: Workflow
let trigger: AutomationTrigger

/** The first 07:00 (studio time) after the trigger's lastFiredAt: the occurrence the next tick fires. */
let occurrence: Date

const MINUTE = 60_000

const studioHour = (date: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: MORNING_REPORT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)

const reportRuns = async () =>
  (
    await payload.find({
      collection: 'workflow-runs',
      where: { workflow: { equals: workflow.id } },
      sort: '-createdAt',
      depth: 0,
    })
  ).docs

const ourResults = (results: Awaited<ReturnType<typeof runScheduledTriggers>>) =>
  results.filter((r) => String(r.workflowId) === String(workflow.id))

beforeAll(async () => {
  t = await getTestPayload()
  payload = t.payload
  ctx = await seed(payload)

  const { docs } = await payload.find({
    collection: 'workflows',
    where: { slug: { equals: WORKFLOW_SLUGS.morningReport } },
    depth: 1,
  })
  workflow = docs[0]!
  trigger = workflow.triggers![0] as AutomationTrigger
  occurrence = new Cron(trigger.schedule!, { timezone: trigger.timezone! }).nextRun(
    new Date(trigger.lastFiredAt!),
  )!
})

afterAll(async () => {
  await t?.cleanup()
})

describe('wiring', () => {
  it('seeds the morning report with its cron in the studio timezone', () => {
    expect(workflow.readOnly).toBe(true)
    expect(trigger.type).toBe('scheduled')
    expect(trigger.schedule).toBe(MORNING_REPORT_SCHEDULE)
    // Seeding in payload-automation 0.3.0 drops the timezone; src/plugins/automation.ts sets it.
    expect(trigger.timezone).toBe(MORNING_REPORT_TIMEZONE)
    // The plugin starts counting from the save, so nothing is backfilled.
    expect(trigger.lastFiredAt).toBeTruthy()
    expect(studioHour(occurrence)).toBe('07:00')
  })

  it('registers the scheduler task on a queue the site runs every minute', async () => {
    const task = payload.config.jobs.tasks?.find((t) => t.slug === SCHEDULED_TRIGGERS_TASK_SLUG)
    expect(task?.schedule).toEqual([
      expect.objectContaining({ cron: '* * * * *', queue: AUTOMATION_QUEUE }),
    ])

    const autoRun = payload.config.jobs.autoRun
    const crons = typeof autoRun === 'function' ? await autoRun(payload) : (autoRun ?? [])
    expect(crons).toContainEqual(expect.objectContaining({ queue: AUTOMATION_QUEUE }))
  })
})

describe('firing', () => {
  it('does not fire before 07:00', async () => {
    const results = await runScheduledTriggers(payload, {
      now: new Date(occurrence.getTime() - MINUTE),
    })
    expect(ourResults(results)).toEqual([])
    expect(await reportRuns()).toHaveLength(0)
  })

  it('fires at 07:00, logs the day ahead and emails the admins', async () => {
    // A class three hours after the report, so the report has something to list.
    await payload.create({
      collection: 'sessions',
      data: {
        workshop: ctx.workshops[0]!.id,
        startsAt: new Date(occurrence.getTime() + 3 * 60 * MINUTE).toISOString(),
        status: 'scheduled',
      },
    })
    const dayEnd = new Date(occurrence.getTime() + 24 * 60 * MINUTE).toISOString()
    const classes = await payload.count({
      collection: 'sessions',
      where: {
        status: { equals: 'scheduled' },
        startsAt: { greater_than_equal: occurrence.toISOString(), less_than: dayEnd },
      },
    })
    const pending = await payload.count({
      collection: 'bookings',
      where: { status: { equals: 'pending' } },
    })
    const sendEmail = vi.spyOn(payload, 'sendEmail')

    // The tick that runs half a minute after the occurrence, as Payload's scheduler would.
    const results = ourResults(
      await runScheduledTriggers(payload, { now: new Date(occurrence.getTime() + MINUTE / 2) }),
    )
    expect(results).toEqual([expect.objectContaining({ status: 'triggered' })])

    const runs = await reportRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('completed')
    expect(runs[0].stepResults?.map((s) => s.status)).toEqual(Array(5).fill('succeeded'))

    const { docs } = await payload.find({
      collection: 'studio-log',
      where: { source: { equals: 'schedule' } },
      depth: 0,
    })
    expect(docs).toHaveLength(1)
    const [entry] = docs
    expect(entry.title).toMatch(/^Morning report: \w+ \d+ \w+$/)
    expect(classes.totalDocs).toBeGreaterThan(0)
    expect(entry.message).toMatch(
      new RegExp(
        `^${classes.totalDocs} class(es)? in the next 24 hours \\(.+\\); ` +
          `${pending.totalDocs} bookings? waiting for payment\\.$`,
      ),
    )

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ctx.admin.email, subject: entry.title }),
    )
  })

  it('fires each occurrence once', async () => {
    const results = await runScheduledTriggers(payload, {
      now: new Date(occurrence.getTime() + MINUTE),
    })
    expect(ourResults(results)).toEqual([])
    expect(await reportRuns()).toHaveLength(1)
  })

  it('shows the next run and the last run on the showcase', async () => {
    const now = new Date(occurrence.getTime() + 2 * MINUTE)
    const status = await getScheduleStatus(payload, WORKFLOW_SLUGS.morningReport, now)
    expect(status).toMatchObject({
      schedule: MORNING_REPORT_SCHEDULE,
      timezone: MORNING_REPORT_TIMEZONE,
      lastRunStatus: 'completed',
    })
    expect(status!.lastRunAt).toBeTruthy()
    const next = new Date(status!.nextRunAt!)
    expect(studioHour(next)).toBe('07:00')
    expect(next.getTime() - occurrence.getTime()).toBeGreaterThanOrEqual(23 * 60 * MINUTE)
    expect(next.getTime() - occurrence.getTime()).toBeLessThanOrEqual(25 * 60 * MINUTE)
  })
})
