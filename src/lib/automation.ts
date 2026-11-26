import { triggerWorkflowById } from '@xtr-dev/payload-automation/server'
import { createLocalReq, Forbidden, type Payload } from 'payload'

import { isAdminUser } from '@/access'
import type { StudioLog, User, Workflow, WorkflowRun } from '@/payload-types'
import { WORKFLOW_SLUGS } from '@/seed/automation'

/**
 * Server-side helpers for the automation showcase: a public-safe view of workflow runs, the
 * studio log, and the admin-only manual run of the "Studio digest" workflow.
 */

export type RunStatus = NonNullable<WorkflowRun['status']>
export type StepStatus = NonNullable<NonNullable<WorkflowRun['stepResults']>[number]['status']>

/** What the public may see of a workflow run: no trigger data, step inputs or outputs. */
export interface RunSummary {
  id: number
  workflowName: string
  workflowSlug: string | null
  status: RunStatus
  startedAt: string | null
  durationMs: number | null
  steps: Array<{ name: string; status: StepStatus; durationMs: number | null; error?: string }>
  /** Only filled in for admins: error messages can quote data from the run. */
  error?: string
}

const toSummary = (run: WorkflowRun, { includeErrors }: { includeErrors: boolean }): RunSummary => {
  const workflow = typeof run.workflow === 'object' ? (run.workflow as Workflow) : null
  return {
    id: run.id,
    workflowName: workflow?.name ?? 'Deleted workflow',
    workflowSlug: workflow?.slug ?? null,
    status: run.status ?? 'pending',
    startedAt: run.startedAt ?? null,
    durationMs: run.duration ?? null,
    steps: (run.stepResults ?? []).map((step) => ({
      name: step.stepName ?? 'Step',
      status: step.status ?? 'pending',
      durationMs: step.duration ?? null,
      ...(includeErrors && step.error ? { error: step.error } : {}),
    })),
    ...(includeErrors && run.error ? { error: run.error } : {}),
  }
}

/**
 * The latest workflow runs, newest first, reduced to a public-safe summary. Runs are admin-only
 * in Payload (they hold trigger snapshots and step inputs/outputs), so this reads them with
 * overrideAccess and selects only the fields the summary needs.
 */
export const getRecentRuns = async (
  payload: Payload,
  { limit = 10, includeErrors = false }: { limit?: number; includeErrors?: boolean } = {},
): Promise<RunSummary[]> => {
  const { docs } = await payload.find({
    collection: 'workflow-runs',
    sort: '-createdAt',
    limit,
    depth: 1,
    overrideAccess: true,
    select: {
      workflow: true,
      status: true,
      startedAt: true,
      duration: true,
      error: true,
      stepResults: { stepName: true, status: true, duration: true, error: true },
    },
    populate: { workflows: { name: true, slug: true } },
  })
  return docs.map((run) => toSummary(run as WorkflowRun, { includeErrors }))
}

/** One run as a summary, or null when it doesn't exist. */
export const getRunSummary = async (
  payload: Payload,
  id: number | string,
  { includeErrors = false }: { includeErrors?: boolean } = {},
): Promise<RunSummary | null> => {
  const run = await payload
    .findByID({ collection: 'workflow-runs', id, depth: 1, overrideAccess: true })
    .catch(() => null)
  return run ? toSummary(run, { includeErrors }) : null
}

/** The latest studio log entries (public read access applies). */
export const getStudioLog = async (payload: Payload, limit = 8): Promise<StudioLog[]> => {
  const { docs } = await payload.find({
    collection: 'studio-log',
    sort: '-createdAt',
    limit,
    depth: 0,
    overrideAccess: false,
  })
  return docs
}

/**
 * Runs the "Studio digest" workflow through its manual trigger and returns the finished run.
 *
 * payload-automation 0.1.0 can only start manual triggers from server code
 * (`triggerWorkflowById`), so this is the one place that does it. Only admins may: the run
 * counts every booking and emails the result to the user who asked.
 */
export const runStudioDigest = async (
  payload: Payload,
  user: User | null | undefined,
): Promise<RunSummary> => {
  if (!user || !isAdminUser(user)) throw new Forbidden()

  const { docs } = await payload.find({
    collection: 'workflows',
    where: { slug: { equals: WORKFLOW_SLUGS.studioDigest } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const workflow = docs[0]
  if (!workflow) throw new Error('The studio digest workflow has not been seeded yet.')

  const req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)
  let runId: number | string | undefined
  try {
    const result = await triggerWorkflowById(
      payload,
      String(workflow.id),
      'manual',
      { sendTo: user.email, requestedAt: new Date().toISOString() },
      req,
    )
    runId = result.runId
  } catch (error) {
    // A failing step makes triggerWorkflowById throw without the run id, but the run is still
    // recorded (as failed), so fall back to this workflow's latest run.
    payload.logger.warn({ err: error }, 'Studio digest run failed')
  }

  if (runId === undefined) {
    const latest = await payload.find({
      collection: 'workflow-runs',
      where: { workflow: { equals: workflow.id } },
      sort: '-createdAt',
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    runId = latest.docs[0]?.id
  }
  const summary =
    runId === undefined ? null : await getRunSummary(payload, runId, { includeErrors: true })
  if (!summary) throw new Error('The studio digest did not record a run.')
  return summary
}
