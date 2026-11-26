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
import type {
  CollectionAfterChangeHook,
  CollectionConfig,
  Endpoint,
  Payload,
  Plugin,
} from 'payload'

import { anyone, isAdmin, isAdminField } from '@/access'
import { automationWorkflows, DEV_WEBHOOK_SECRET } from '@/seed/automation'

import { extendCollection } from './utils'

/**
 * @xtr-dev/payload-automation
 *
 * Four code-defined workflows (see src/seed/automation.ts):
 * - "Booking confirmed": a bookings afterChange hook with a JSONata condition; reads the session,
 *   workshop and member, emails a confirmation and writes a studio log entry.
 * - "Kiln temperature alert": a webhook trigger with a hashed secret; calls the site's mock pager
 *   over HTTP and logs the alert.
 * - "Opening hours changed": a site-settings afterChange hook.
 * - "Studio digest": a manual trigger, run from server code by admins (src/lib/automation.ts).
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
 * Deletes completed jobs that no workflow run is waiting on: every other plugin's (mailing,
 * billing, ...) finished jobs. Together with `keepStepJobsPlugin` this restores Payload's default
 * clean-up for everything except automation's step jobs. Uses the database adapter directly, the
 * same way Payload deletes completed jobs when `jobs.runHooks` is off.
 */
export const deleteCompletedNonWorkflowJobs = async (payload: Payload): Promise<void> => {
  await payload.db.deleteMany({
    collection: 'payload-jobs',
    where: {
      and: [{ completedAt: { exists: true } }, { automationWorkflowRun: { exists: false } }],
    },
  })
}

/**
 * Keeps finished jobs until their workflow run has read them.
 *
 * The plugin runs each step as a Payload job and reads the step's output back from the job
 * afterwards. With Payload's default `deleteJobOnComplete: true` the job is already gone by then,
 * so every `steps.<name>.output` would be empty. Payload only has this setting for all jobs, so:
 * - step jobs are deleted by `deleteStepJobsWhenRunEnds` once their run has finished;
 * - other plugins' completed jobs are deleted on every job-runner tick, by wrapping the
 *   `shouldAutoRun` chain that mailing and billing set up (their result is passed through).
 * Other `jobs` settings (tasks, autoRun crons) are kept as they are.
 */
const keepStepJobsPlugin: Plugin = (config) => {
  const jobs = config.jobs ?? {}
  const previousShouldAutoRun = jobs.shouldAutoRun
  return {
    ...config,
    jobs: {
      ...jobs,
      tasks: jobs.tasks ?? [],
      deleteJobOnComplete: false,
      shouldAutoRun: async (payload) => {
        try {
          await deleteCompletedNonWorkflowJobs(payload)
        } catch (error) {
          payload.logger.warn({ err: error, msg: 'Could not clean up completed jobs' })
        }
        return previousShouldAutoRun ? previousShouldAutoRun(payload) : true
      },
    },
  }
}

const FINISHED_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled'])

/** Deletes a run's step jobs once the run has finished, since `keepStepJobsPlugin` keeps them. */
const deleteStepJobsWhenRunEnds: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  if (!FINISHED_RUN_STATUSES.has(doc.status) || FINISHED_RUN_STATUSES.has(previousDoc?.status)) {
    return doc
  }
  await req.payload.delete({
    collection: 'payload-jobs',
    where: { automationWorkflowRun: { equals: doc.id } },
    overrideAccess: true,
    req,
  })
  return doc
}

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

export const automation: Plugin[] = [
  studioLogPlugin,
  keepStepJobsPlugin,
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
  }),
  extendCollection('workflow-runs', (collection) => ({
    ...collection,
    hooks: {
      ...collection.hooks,
      afterChange: [...(collection.hooks?.afterChange ?? []), deleteStepJobsWhenRunEnds],
    },
  })),
]
