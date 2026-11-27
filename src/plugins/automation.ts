import { randomBytes, randomUUID } from 'crypto'

import {
  CreateDocumentStepTask,
  DeleteDocumentStepTask,
  HttpRequestStepTask,
  ReadDocumentStepTask,
  SendEmailStepTask,
  UpdateDocumentStepTask,
  workflowsPlugin,
} from '@xtr-dev/payload-automation/server'
import type { CollectionConfig, Endpoint, JobsConfig, Plugin } from 'payload'

import { anyone, isAdmin, isAdminField } from '@/access'
import { AUTOMATION_QUEUE, automationWorkflows, DEV_WEBHOOK_SECRET } from '@/seed/automation'

/**
 * @xtr-dev/payload-automation
 *
 * Five code-defined workflows (see src/seed/automation.ts):
 * - "Booking confirmed": a bookings afterChange hook with a JSONata condition; reads the session,
 *   workshop and member, emails a confirmation and writes a studio log entry.
 * - "Kiln temperature alert": a webhook trigger with a hashed secret; calls the site's mock pager
 *   over HTTP and logs the alert.
 * - "Opening hours changed": a site-settings afterChange hook.
 * - "Studio digest": a manual trigger, run from server code by admins (src/lib/automation.ts).
 * - "Morning kiln-room report": a scheduled (cron) trigger, every morning at 07:00 studio time;
 *   fired by the plugin's `automation-scheduled-triggers` job task on the `automation` queue,
 *   which `automationJobs` below runs every minute.
 *
 * Env: AUTOMATION_WEBHOOK_SECRET (the kiln alert webhook secret) and, optionally,
 * PUBLIC_KILN_PAGER_URL (where the alert workflow's HTTP step posts; defaults to this site).
 */

/**
 * The kiln alert webhook secret. Development, tests and CI fall back to a public default; a
 * production server without the variable gets a random secret, so the webhook cannot be called
 * until AUTOMATION_WEBHOOK_SECRET is set (the plugin stores the secret's hash when it first seeds
 * the workflow).
 */
const webhookSecret =
  process.env.AUTOMATION_WEBHOOK_SECRET ||
  (process.env.NODE_ENV === 'production' ? randomBytes(32).toString('hex') : DEV_WEBHOOK_SECRET)

/** The studio log: a public timeline that the workflows write to. */
export const StudioLog: CollectionConfig = {
  slug: 'studio-log',
  labels: { singular: 'Studio log entry', plural: 'Studio log' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'source', 'severity', 'createdAt'],
    group: 'Studio',
    description: 'Written by the automation workflows. Shown publicly on /showcase#automation.',
  },
  defaultSort: '-createdAt',
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'message',
      type: 'textarea',
      admin: { description: 'Public text: keep member names, emails and references out of it.' },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'source',
          type: 'select',
          required: true,
          defaultValue: 'manual',
          options: [
            { label: 'Booking', value: 'booking' },
            { label: 'Kiln webhook', value: 'webhook' },
            { label: 'Site settings', value: 'settings' },
            { label: 'Manual run', value: 'manual' },
            { label: 'Schedule', value: 'schedule' },
          ],
        },
        {
          name: 'severity',
          type: 'select',
          required: true,
          defaultValue: 'info',
          options: [
            { label: 'Info', value: 'info' },
            { label: 'Warning', value: 'warning' },
          ],
        },
      ],
    },
    {
      name: 'booking',
      type: 'relationship',
      relationTo: 'bookings',
      admin: { position: 'sidebar', description: 'The booking this entry is about, if any.' },
      // The log is public; which booking an entry belongs to is not.
      access: { read: isAdminField },
    },
  ],
}

/**
 * A stand-in for an external paging service, called by the kiln alert workflow's HTTP request
 * step. It has no side effects; it only answers like a pager API would.
 */
const kilnPagerEndpoint: Endpoint = {
  path: '/studio/kiln-pager',
  method: 'post',
  handler: async (req) => {
    let body: { kiln?: unknown } | null = null
    try {
      body = (await req.json?.()) ?? null
    } catch {
      body = null
    }
    return Response.json({
      paged: true,
      onCall: 'Ines (kiln technician)',
      ticket: `PG-${randomUUID().slice(0, 6).toUpperCase()}`,
      kiln: typeof body?.kiln === 'string' ? body.kiln : null,
    })
  },
}

/** Adds the studio log collection and the mock pager endpoint. */
const studioLogPlugin: Plugin = (config) => ({
  ...config,
  collections: [...(config.collections ?? []), StudioLog],
  endpoints: [...(config.endpoints ?? []), kilnPagerEndpoint],
})

/**
 * Points the kiln alert workflow's HTTP step at this site's mock pager, unless
 * PUBLIC_KILN_PAGER_URL is set. Runs in onInit, which Next.js reaches on the first request, after
 * it has stored the port it listens on in `PORT`. The workflow reads the value at run time through
 * JSONata's `$env`, which only exposes `PUBLIC_` variables.
 */
const pagerUrlPlugin: Plugin = (config) => {
  const incomingOnInit = config.onInit
  return {
    ...config,
    onInit: async (payload) => {
      if (!process.env.PUBLIC_KILN_PAGER_URL) {
        const origin = process.env.PORT
          ? `http://localhost:${process.env.PORT}`
          : process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'
        process.env.PUBLIC_KILN_PAGER_URL = `${origin}/api/studio/kiln-pager`
      }
      await incomingOnInit?.(payload)
    },
  }
}

/**
 * Runs the automation queue every minute, without dropping other plugins' crons. The plugin's
 * scheduled-triggers task is registered with a Payload `schedule` on this queue; Payload's
 * autoRun handles that schedule (queues the task) and then runs the queue, so scheduled
 * workflows fire at most about a minute after their cron time. Without a runner for this queue
 * they would never fire.
 */
const automationJobs: Plugin = (config) => {
  const jobs: JobsConfig = config.jobs ?? {}
  const autoRun = jobs.autoRun
  const ours = [{ cron: '* * * * *', queue: AUTOMATION_QUEUE }]
  const otherShouldAutoRun = jobs.shouldAutoRun
  return {
    ...config,
    jobs: {
      ...jobs,
      autoRun:
        typeof autoRun === 'function'
          ? async (payload) => [...(await autoRun(payload)), ...ours]
          : [...(autoRun ?? []), ...ours],
      // Tests set DISABLE_JOBS_AUTORUN so no cron fires while they run.
      shouldAutoRun: async (payload) =>
        process.env.DISABLE_JOBS_AUTORUN !== 'true' &&
        (otherShouldAutoRun ? await otherShouldAutoRun(payload) : true),
    },
  }
}

export const automation: Plugin[] = [
  studioLogPlugin,
  pagerUrlPlugin,
  workflowsPlugin({
    collectionTriggers: { bookings: { afterChange: true } },
    globalTriggers: { 'site-settings': { afterChange: true } },
    steps: [
      HttpRequestStepTask,
      CreateDocumentStepTask,
      ReadDocumentStepTask,
      UpdateDocumentStepTask,
      DeleteDocumentStepTask,
      SendEmailStepTask,
    ],
    seedWorkflows: automationWorkflows({ webhookSecret }),
    // Runs store `users:<id>` as triggeredBy instead of an email, and keep the acting user out of
    // the stored trigger snapshot.
    stripUserData: true,
    // Look for due scheduled triggers every minute, on the queue automationJobs runs.
    scheduledTriggers: { tick: '* * * * *', queue: AUTOMATION_QUEUE },
  }),
  automationJobs,
]
