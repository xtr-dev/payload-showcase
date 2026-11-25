import type { SeedWorkflow } from '@xtr-dev/payload-automation'
import type { Payload } from 'payload'

import type { SeedContext } from './types'

/**
 * The studio's code-defined workflows. `src/plugins/automation.ts` hands them to the plugin's
 * `seedWorkflows` option, which creates each one (with its triggers and steps) on boot when no
 * workflow with that slug exists yet, and marks it read-only in the admin panel.
 *
 * Expression rules in payload-automation 0.1.0, which these definitions follow:
 * - A step input value that starts with `{{` is evaluated as one JSONata expression; text around
 *   it is not interpolated, so strings are built with JSONata's `&` operator.
 * - Earlier steps are read as ``steps.`<step name>`.output`` (keyed by the step's name).
 * - Trigger conditions are plain JSONata (no braces) and see `trigger.doc`, `trigger.previousDoc`,
 *   `trigger.operation` and, for webhooks, the JSON body as `trigger.doc`.
 */

/** Slugs of the seeded workflows, used by the site to find them and their runs. */
export const WORKFLOW_SLUGS = {
  bookingConfirmed: 'booking-confirmed',
  kilnAlert: 'kiln-temperature-alert',
  openingHours: 'opening-hours-changed',
  studioDigest: 'studio-digest',
} as const

/** Path segment of the kiln alert webhook: POST /api/automation/webhooks/kiln-alert. */
export const KILN_ALERT_WEBHOOK_PATH = 'kiln-alert'

/** Kiln temperature (°C) from which an incoming reading counts as an alert. */
export const KILN_ALERT_THRESHOLD_C = 1250

/**
 * Secret used for the kiln alert webhook when AUTOMATION_WEBHOOK_SECRET is not set, so that
 * development, tests and CI work without configuration. It is public, so production deployments
 * must set their own (see .env.example).
 */
export const DEV_WEBHOOK_SECRET = 'kiln-dev-webhook-secret-change-me'

/** JSONata for the id of a relationship value at `path`, whether or not it is populated. */
const relIdExpr = (path: string) => `($type(${path}) = "object" ? ${path}.id : ${path})`

/** JSONata formatting the date-time at `path` as "Sat 12 Dec, 10:00" in studio winter time (CET). */
const studioDateExpr = (path: string) =>
  `$fromMillis($toMillis(${path}), "[FNn,*-3] [D] [MNn,*-3], [H01]:[m01]", "+0100")`

export interface AutomationWorkflowOptions {
  /** Shared secret for the kiln alert webhook. Only its SHA-256 hash is stored. */
  webhookSecret: string
}

/** Builds the seeded workflow definitions. The webhook secret comes from the plugin config. */
export const automationWorkflows = ({
  webhookSecret,
}: AutomationWorkflowOptions): SeedWorkflow[] => [
  {
    slug: WORKFLOW_SLUGS.bookingConfirmed,
    name: 'Booking confirmed',
    description:
      'When a booking moves to "paid" (the studio\'s confirmed state), look up the session, ' +
      'workshop and member, email the member a confirmation and write a studio log entry.',
    triggers: [
      {
        type: 'collection-hook',
        parameters: { collectionSlug: 'bookings', hook: 'afterChange' },
        // Only the change into "paid" counts, so re-saving a paid booking (or seeding paid
        // bookings) does not send a second confirmation.
        condition:
          'trigger.operation = "update" and trigger.doc.status = "paid" and trigger.previousDoc.status != "paid"',
      },
    ],
    steps: [
      {
        name: 'Read session',
        slug: 'read-session',
        type: 'read-document',
        input: {
          collectionSlug: 'sessions',
          id: `{{${relIdExpr('trigger.doc.session')}}}`,
          depth: 0,
        },
      },
      {
        name: 'Read member',
        slug: 'read-member',
        type: 'read-document',
        input: {
          collectionSlug: 'users',
          id: `{{${relIdExpr('trigger.doc.member')}}}`,
          depth: 0,
        },
      },
      {
        name: 'Read workshop',
        slug: 'read-workshop',
        type: 'read-document',
        dependencies: ['read-session'],
        input: {
          collectionSlug: 'workshops',
          id: `{{${relIdExpr('steps.`Read session`.output.doc.workshop')}}}`,
          depth: 0,
        },
      },
      {
        name: 'Email confirmation',
        slug: 'email-confirmation',
        type: 'send-email',
        dependencies: ['read-member', 'read-workshop'],
        input: {
          to: '{{steps.`Read member`.output.doc.email}}',
          subject: '{{"Your seat in " & steps.`Read workshop`.output.doc.title & " is confirmed"}}',
          text:
            '{{"Hi " & steps.`Read member`.output.doc.name & ",\\n\\nYour seat in " & ' +
            'steps.`Read workshop`.output.doc.title & " on " & ' +
            studioDateExpr('steps.`Read session`.output.doc.startsAt') +
            ' & " is confirmed (booking " & trigger.doc.reference & ").\\n\\nAprons are on us. See you at the wheel!\\n\\nKiln & Co."}}',
        },
      },
      {
        name: 'Write studio log',
        slug: 'write-studio-log',
        type: 'create-document',
        dependencies: ['email-confirmation'],
        input: {
          collectionSlug: 'studio-log',
          data: {
            title: '{{"Seat confirmed: " & steps.`Read workshop`.output.doc.title}}',
            // Public text: no member name, email or booking reference.
            message:
              '{{"A seat for " & ' +
              studioDateExpr('steps.`Read session`.output.doc.startsAt') +
              ' & " was confirmed and the confirmation email went out."}}',
            source: 'booking',
            severity: 'info',
            booking: '{{trigger.doc.id}}',
          },
        },
      },
    ],
  },
  {
    slug: WORKFLOW_SLUGS.kilnAlert,
    name: 'Kiln temperature alert',
    description:
      'The kiln controller posts its readings to a webhook. Readings at or above ' +
      `${KILN_ALERT_THRESHOLD_C} °C page the kiln technician (an HTTP request to the site's mock ` +
      'pager) and write a warning to the studio log with the pager ticket.',
    triggers: [
      {
        type: 'webhook',
        parameters: { webhookPath: KILN_ALERT_WEBHOOK_PATH, webhookSecret },
        condition: `$number(trigger.doc.temperatureC) >= ${KILN_ALERT_THRESHOLD_C}`,
      },
    ],
    steps: [
      {
        name: 'Page kiln technician',
        slug: 'page-technician',
        type: 'http-request-step',
        input: {
          // The pager URL is resolved at run time (see src/plugins/automation.ts), so the same
          // workflow works on the dev server, the e2e server and in tests.
          url: '{{$env("PUBLIC_KILN_PAGER_URL")}}',
          method: 'POST',
          body: {
            kiln: '{{$string(trigger.doc.kiln)}}',
            temperatureC: '{{$number(trigger.doc.temperatureC)}}',
          },
          timeout: 5000,
        },
      },
      {
        name: 'Write studio log',
        slug: 'write-studio-log',
        type: 'create-document',
        dependencies: ['page-technician'],
        input: {
          collectionSlug: 'studio-log',
          data: {
            title:
              '{{"Kiln alert: " & $string(trigger.doc.kiln) & " at " & $string($number(trigger.doc.temperatureC)) & " °C"}}',
            message:
              '{{"Paged " & steps.`Page kiln technician`.output.data.onCall & " (ticket " & steps.`Page kiln technician`.output.data.ticket & ")."}}',
            source: 'webhook',
            severity: 'warning',
          },
        },
      },
    ],
  },
  {
    slug: WORKFLOW_SLUGS.openingHours,
    name: 'Opening hours changed',
    description:
      'When the opening hours in Site settings change, record the new hours in the studio log.',
    triggers: [
      {
        type: 'global-hook',
        parameters: { globalSlug: 'site-settings', hook: 'afterChange' },
        // Compares the hours as text. When there were no hours before (a fresh database being
        // seeded), $join yields undefined and the comparison is false, so seeding stays quiet.
        condition:
          '$join(trigger.doc.openingHours.(days & " " & hours), "; ") != $join(trigger.previousDoc.openingHours.(days & " " & hours), "; ")',
      },
    ],
    steps: [
      {
        name: 'Write studio log',
        slug: 'write-studio-log',
        type: 'create-document',
        input: {
          collectionSlug: 'studio-log',
          data: {
            title: 'Opening hours updated',
            message:
              '{{"Now open: " & $join(trigger.doc.openingHours.(days & " " & hours), " · ")}}',
            source: 'settings',
            severity: 'info',
          },
        },
      },
    ],
  },
  {
    slug: WORKFLOW_SLUGS.studioDigest,
    name: 'Studio digest',
    description:
      'Run on demand by an admin: counts confirmed bookings and recent log entries, writes a ' +
      'digest to the studio log and emails it to the admin who asked for it.',
    triggers: [{ type: 'manual' }],
    steps: [
      {
        name: 'Count confirmed bookings',
        slug: 'count-bookings',
        type: 'read-document',
        input: {
          collectionSlug: 'bookings',
          where: { status: { equals: 'paid' } },
          limit: 1,
          depth: 0,
        },
      },
      {
        name: 'Count log entries',
        slug: 'count-log',
        type: 'read-document',
        input: { collectionSlug: 'studio-log', limit: 1, depth: 0 },
      },
      {
        name: 'Write studio log',
        slug: 'write-studio-log',
        type: 'create-document',
        dependencies: ['count-bookings', 'count-log'],
        input: {
          collectionSlug: 'studio-log',
          data: {
            title: 'Studio digest',
            message:
              '{{$string(steps.`Count confirmed bookings`.output.totalDocs) & " confirmed bookings and " & $string(steps.`Count log entries`.output.totalDocs) & " earlier log entries."}}',
            source: 'manual',
            severity: 'info',
          },
        },
      },
      {
        name: 'Email digest',
        slug: 'email-digest',
        type: 'send-email',
        dependencies: ['write-studio-log'],
        input: {
          to: '{{trigger.data.sendTo}}',
          subject: 'Kiln & Co. studio digest',
          text: '{{steps.`Write studio log`.output.doc.message}}',
        },
      },
    ],
  },
]

/** Collections whose content the automation seed owns and clears on reset. */
const AUTOMATION_HISTORY_COLLECTIONS = ['studio-log', 'workflow-runs'] as const

/**
 * Seed data for the Automation integration.
 *
 * The workflows themselves are seeded by the plugin from `automationWorkflows` (they are code,
 * not data). This seed owns the run history and the studio log: on reset it clears both, so the
 * history only shows what happened since the last `pnpm seed`. Payload jobs that workflow steps
 * created are removed along with their runs.
 */
export const seedAutomation = async (
  payload: Payload,
  _ctx: SeedContext,
  { reset }: { reset: boolean },
): Promise<void> => {
  if (!reset) return
  await payload.delete({
    collection: 'payload-jobs',
    where: { automationWorkflowRun: { exists: true } },
    overrideAccess: true,
  })
  for (const collection of AUTOMATION_HISTORY_COLLECTIONS) {
    await payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true })
  }
}
