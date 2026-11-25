import type { SeedWorkflow } from '@xtr-dev/payload-automation'

import { Badge } from '@/components/ui'
import { KILN_ALERT_WEBHOOK_PATH } from '@/seed/automation'

type SeedStep = SeedWorkflow['steps'][number]
type SeedTrigger = SeedWorkflow['triggers'][number]

const STEP_TYPE_LABELS: Record<string, string> = {
  'read-document': 'Read document',
  'create-document': 'Create document',
  'update-document': 'Update document',
  'delete-document': 'Delete document',
  'send-email': 'Send email',
  'http-request-step': 'HTTP request',
}

/** "Collection hook · bookings.afterChange" and friends, from a seeded trigger definition. */
const describeTrigger = (trigger: SeedTrigger): { kind: string; target: string } => {
  const p = trigger.parameters ?? {}
  switch (trigger.type) {
    case 'collection-hook':
      return { kind: 'Collection hook', target: `${p.collectionSlug}.${p.hook}` }
    case 'global-hook':
      return { kind: 'Global hook', target: `${p.globalSlug}.${p.hook}` }
    case 'webhook':
      return {
        kind: 'Webhook',
        target: `POST /api/automation/webhooks/${p.webhookPath ?? KILN_ALERT_WEBHOOK_PATH}`,
      }
    case 'manual':
      return { kind: 'Manual', target: 'started from server code' }
    default:
      return { kind: trigger.type, target: '' }
  }
}

/**
 * Groups steps into the batches the plugin runs them in: a step runs once every step it depends
 * on has finished, and steps in the same batch run in parallel.
 */
export const stepBatches = (steps: SeedStep[]): SeedStep[][] => {
  const level = new Map<string, number>()
  const slugOf = (s: SeedStep) => s.slug ?? s.name
  const levelOf = (step: SeedStep): number => {
    const known = level.get(slugOf(step))
    if (known !== undefined) return known
    const deps = (step.dependencies ?? []).map((d) => steps.find((s) => slugOf(s) === d)!)
    const value = deps.length ? Math.max(...deps.map(levelOf)) + 1 : 0
    level.set(slugOf(step), value)
    return value
  }
  const batches: SeedStep[][] = []
  for (const step of steps) (batches[levelOf(step)] ??= []).push(step)
  return batches
}

/** A seeded workflow drawn as trigger → condition → step batches. */
export const WorkflowCard = ({ workflow }: { workflow: SeedWorkflow }) => {
  const trigger = workflow.triggers[0]
  const { kind, target } = describeTrigger(trigger)
  return (
    <li className="rounded-xl border border-line bg-paper p-4" data-testid="workflow-card">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-display text-lg text-ink">{workflow.name}</h4>
        <Badge tone="glaze">{kind}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-soft">{workflow.description}</p>
      <p className="mt-3 font-mono text-xs break-words text-ink">{target}</p>
      {trigger.condition && (
        <p className="mt-1 text-xs text-ink-soft">
          <span className="font-semibold">only if </span>
          <code className="font-mono break-words text-ink">{trigger.condition}</code>
        </p>
      )}
      <ol className="mt-3 space-y-2" aria-label={`${workflow.name} steps`}>
        {stepBatches(workflow.steps).map((batch, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="text-clay">
              {i === 0 ? '→' : '↳'}
            </span>
            {batch.map((step) => (
              <span
                key={step.name}
                className="rounded-pill border border-line bg-white/70 px-3 py-1 text-xs"
              >
                <span className="font-semibold text-ink">{step.name}</span>{' '}
                <span className="text-ink-soft">({STEP_TYPE_LABELS[step.type] ?? step.type})</span>
              </span>
            ))}
            {batch.length > 1 && <span className="text-xs text-ink-soft">in parallel</span>}
          </li>
        ))}
      </ol>
    </li>
  )
}
