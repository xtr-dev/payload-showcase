import Link from 'next/link'

import { Badge, type BadgeTone } from '@/components/ui'
import type { RunStatus, RunSummary, StepStatus } from '@/lib/automation'
import { formatDate, formatTime } from '@/lib/format'

export const RUN_STATUS: Record<RunStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  running: { label: 'Running', tone: 'glaze' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

const STEP_STATUS: Record<StepStatus, { label: string; className: string }> = {
  pending: { label: 'pending', className: 'border-line text-ink-soft' },
  running: { label: 'running', className: 'border-glaze/40 text-glaze-deep' },
  succeeded: { label: 'ok', className: 'border-success/40 bg-success-soft text-success' },
  failed: { label: 'failed', className: 'border-danger/40 bg-danger-soft text-danger' },
  skipped: { label: 'skipped', className: 'border-line bg-sand/40 text-ink-soft' },
}

const formatMs = (ms: number | null) =>
  ms === null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`

/** One workflow run: status, when it started, and each step's outcome in order. */
export const RunItem = ({ run, adminLinks = false }: { run: RunSummary; adminLinks?: boolean }) => {
  const status = RUN_STATUS[run.status]
  return (
    <li className="py-4" data-testid="workflow-run" data-workflow={run.workflowSlug ?? ''}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink">{run.workflowName}</p>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Run #{run.id}
        {run.startedAt && ` · ${formatDate(run.startedAt)}, ${formatTime(run.startedAt)}`}
        {run.durationMs !== null && ` · ${formatMs(run.durationMs)}`}
        {adminLinks && (
          <>
            {' · '}
            <Link
              href={`/admin/collections/workflow-runs/${run.id}`}
              className="font-semibold text-clay underline-offset-4 hover:underline"
            >
              Open in admin
            </Link>
          </>
        )}
      </p>
      <ol className="mt-3 flex flex-wrap gap-2" aria-label="Steps">
        {run.steps.map((step, i) => {
          const s = STEP_STATUS[step.status]
          return (
            <li
              key={`${step.name}-${i}`}
              className={`rounded-pill border px-3 py-1 text-xs font-semibold ${s.className}`}
            >
              {step.name} · {s.label}
              {step.attempts > 1 && (
                <span className="font-normal"> · {step.attempts} attempts</span>
              )}
              {step.durationMs !== null && step.status === 'succeeded' && (
                <span className="font-normal"> · {formatMs(step.durationMs)}</span>
              )}
            </li>
          )
        })}
      </ol>
      {run.error && <p className="mt-2 text-sm text-danger">{run.error}</p>}
    </li>
  )
}

export const RunList = ({ runs, adminLinks }: { runs: RunSummary[]; adminLinks?: boolean }) =>
  runs.length === 0 ? (
    <p className="mt-3 text-ink-soft" data-testid="workflow-runs-empty">
      No runs yet. Confirm a booking, post a kiln alert or change the opening hours to start one.
    </p>
  ) : (
    <ul className="mt-2 divide-y divide-line" data-testid="workflow-runs">
      {runs.map((run) => (
        <RunItem key={run.id} run={run} adminLinks={adminLinks} />
      ))}
    </ul>
  )
