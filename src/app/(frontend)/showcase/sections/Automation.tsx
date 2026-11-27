import Link from 'next/link'

import { Alert, Badge, Card } from '@/components/ui'
import { isAdminUser } from '@/access'
import { getCurrentUser } from '@/lib/auth'
import { getRecentRuns, getScheduleStatus, getStudioLog } from '@/lib/automation'
import { formatDate, formatTime } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import {
  automationWorkflows,
  KILN_ALERT_THRESHOLD_C,
  KILN_ALERT_WEBHOOK_PATH,
  WORKFLOW_SLUGS,
} from '@/seed/automation'

import { ShowcaseSection } from '../ShowcaseSection'
import { DigestButton } from './automation/DigestButton'
import { RunList } from './automation/RunList'
import { WorkflowCard } from './automation/WorkflowCard'

/** The workflow definitions as seeded; the secret is not needed to draw them. */
const WORKFLOWS = automationWorkflows({ webhookSecret: '' })

const CURL_EXAMPLE = `curl -X POST http://localhost:3000/api/automation/webhooks/${KILN_ALERT_WEBHOOK_PATH} \\
  -H "X-Webhook-Secret: $AUTOMATION_WEBHOOK_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"kiln": "Big Bertha", "temperatureC": 1290}'`

/** Showcase for @xtr-dev/payload-automation: the seeded workflows, their latest runs and the studio log. */
export const AutomationShowcase = async () => {
  const [payload, user] = await Promise.all([getPayloadClient(), getCurrentUser()])
  const isAdmin = isAdminUser(user)
  const [runs, log, morningReport] = await Promise.all([
    getRecentRuns(payload, { limit: 5, includeErrors: isAdmin }),
    getStudioLog(payload, 5),
    getScheduleStatus(payload, WORKFLOW_SLUGS.morningReport),
  ])

  return (
    <ShowcaseSection
      id="automation"
      pkg="@xtr-dev/payload-automation"
      title="Workflows that run themselves"
      intro="Studio routines as code-defined workflows that build on the other plugins: a confirmed booking gets a what-to-bring note in the member’s inbox and a studio log entry, a hot kiln pages the technician and posts studio news, and every morning a report on the day ahead lands in the studio log."
      features={[
        'Collection-hook trigger with a JSONata condition: a booking moving to paid',
        'Works with mailing and notifications: checks their confirmation email and inbox message, adds tips without duplicating either',
        'Webhook trigger behind a hashed secret: kiln alerts that page the technician and broadcast studio news',
        'Global-hook trigger: opening hours changed in Site settings',
        'Scheduled (cron) trigger in the studio’s timezone: a morning report at 07:00, fired by Payload’s job scheduler',
        'Manual run from server code, behind an admin-only button',
        'Read, create, send-email and HTTP request steps, with dependencies, step conditions and step outputs',
        'Step retries: the pager call is tried up to three times before the alert run fails',
        'A custom step: the shop’s own task that releases unpaid orders, run every 15 minutes',
        'Run history with every step’s result, here and in the admin panel',
      ]}
      usedOn={[
        ['Run history', '/showcase/automation'],
        ['Workflows (admin)', '/admin/collections/workflows'],
        ['Workflow runs (admin)', '/admin/collections/workflow-runs'],
      ]}
      status="live"
      tone="paper"
    >
      <div className="space-y-6">
        <Card as="section" className="p-6" aria-labelledby="automation-workflows-heading">
          <h3 id="automation-workflows-heading" className="text-2xl text-ink">
            Seven workflows, seeded from code
          </h3>
          <p className="mt-2 text-sm text-ink-soft">
            Defined in <code className="font-mono">src/seed/automation.ts</code> and created by the
            plugin on boot. They are read-only in the admin panel.
          </p>
          <ul className="mt-4 space-y-3">
            {WORKFLOWS.map((workflow) => (
              <WorkflowCard
                key={workflow.slug}
                workflow={workflow}
                schedule={workflow.slug === WORKFLOW_SLUGS.morningReport ? morningReport : null}
              />
            ))}
          </ul>
        </Card>

        <Card as="section" className="p-6" aria-labelledby="automation-runs-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="automation-runs-heading" className="text-2xl text-ink">
              Latest runs
            </h3>
            <Link
              href="/showcase/automation"
              className="text-sm font-semibold text-clay underline-offset-4 hover:underline"
            >
              Full run history
            </Link>
          </div>
          <RunList runs={runs} adminLinks={isAdmin} />
        </Card>

        <Card as="section" className="p-6" aria-labelledby="automation-log-heading">
          <h3 id="automation-log-heading" className="text-2xl text-ink">
            Studio log
          </h3>
          <p className="mt-2 text-sm text-ink-soft">
            Every entry here was written by a workflow step.
          </p>
          {log.length === 0 ? (
            <p className="mt-3 text-ink-soft">The log is empty.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line" data-testid="studio-log">
              {log.map((entry) => (
                <li key={entry.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">{entry.title}</p>
                    {entry.severity === 'warning' && <Badge tone="warning">Warning</Badge>}
                  </div>
                  {entry.message && <p className="text-sm text-ink-soft">{entry.message}</p>}
                  <p className="mt-1 text-xs text-ink-soft">
                    {formatDate(entry.createdAt)}, {formatTime(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card as="section" className="p-6" aria-labelledby="automation-try-heading">
          <h3 id="automation-try-heading" className="text-2xl text-ink">
            Try it
          </h3>
          <ul className="prose-kiln mt-3 text-base">
            <li>
              <strong className="text-ink">Confirm a booking:</strong> sign in as the admin, open a
              pending booking in the admin panel and set its status to Paid.
            </li>
            <li>
              <strong className="text-ink">Change the opening hours</strong> in Site settings.
            </li>
            <li>
              <strong className="text-ink">Leave the dev server running overnight:</strong> the job
              runner checks the schedule every minute, so the morning report shows up in the studio
              log (and the admin’s captured mail) shortly after 07:00.
            </li>
            <li>
              <strong className="text-ink">Post a kiln reading</strong> at or above{' '}
              {KILN_ALERT_THRESHOLD_C} °C (lower readings are skipped by the trigger condition).
              Without the secret the webhook answers 401. Locally,{' '}
              <code className="font-mono">bash scripts/kiln-alert.sh</code> does it for you.
            </li>
          </ul>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-ink p-4 font-mono text-xs leading-relaxed text-paper">
            <code>{CURL_EXAMPLE}</code>
          </pre>
          {isAdmin ? (
            <DigestButton />
          ) : (
            <p className="mt-4 text-sm text-ink-soft">
              Signed in as an admin, you get a button here that runs the “Studio digest” workflow
              through its manual trigger and shows the result.
            </p>
          )}
        </Card>

        <Alert tone="warning" title="Not shown, because it doesn’t work yet">
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              Manual triggers can only be started from server code. The admin panel has no run
              button, so the digest button above calls the plugin’s server API.
            </li>
            <li>
              Seeded workflows are created once and not updated when their code changes. Delete{' '}
              <code className="font-mono">kiln.db</code> and run{' '}
              <code className="font-mono">pnpm seed</code> to pick up changes.
            </li>
          </ul>
        </Alert>
      </div>
    </ShowcaseSection>
  )
}
