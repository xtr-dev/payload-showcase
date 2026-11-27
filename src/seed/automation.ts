import type { SeedWorkflow } from '@xtr-dev/payload-automation'
import type { Payload } from 'payload'

import { STUDIO_TIME_ZONE } from '@/lib/format'
import { richText } from '@/lib/richtext'

import type { SeedContext } from './types'

/**
 * The studio's code-defined workflows. `src/plugins/automation.ts` hands them to the plugin's
 * `seedWorkflows` option, which creates each one (with its triggers and steps) on boot when no
 * workflow with that slug exists yet, and marks it read-only in the admin panel.
 *
 * Expression rules in payload-automation 0.3.0, which these definitions follow:
 * - A step input value that starts with `{{` is evaluated as one JSONata expression; text around
 *   it is not interpolated, so strings are built with JSONata's `&` operator.
 * - Earlier steps are read as ``steps.`<step name>`.output`` (keyed by the step's name).
 * - Trigger conditions are plain JSONata (no braces) and see `trigger.doc`, `trigger.previousDoc`,
 *   `trigger.operation` and, for webhooks, the JSON body as `trigger.doc`.
 * - Scheduled triggers expose `trigger.scheduledAt` (the cron occurrence being fired, ISO) and
 *   `trigger.firedAt`.
 */

/** Slugs of the seeded workflows, used by the site to find them and their runs. */
export const WORKFLOW_SLUGS = {
  bookingConfirmed: 'booking-confirmed',
  kilnAlert: 'kiln-temperature-alert',
  openingHours: 'opening-hours-changed',
  studioDigest: 'studio-digest',
  morningReport: 'morning-kiln-room-report',
} as const

/**
 * Jobs queue of the plugin's scheduled-triggers task. src/plugins/automation.ts registers the task
 * on it and runs it every minute.
 */
export const AUTOMATION_QUEUE = 'automation'

/** When the morning report runs: every day at 07:00, in MORNING_REPORT_TIMEZONE. */
export const MORNING_REPORT_SCHEDULE = '0 7 * * *'

/** The studio's timezone, which the morning report's schedule is evaluated in. */
export const MORNING_REPORT_TIMEZONE = STUDIO_TIME_ZONE

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
      'When a booking moves to "paid" (the studio\'s confirmed state), mailing has already ' +
      'queued the confirmation email and notifications has posted the "Booking confirmed" ' +
      'message. This workflow adds what neither does: it checks both went out, sends the member ' +
      'a one-off "what to bring" note for their workshop, and records it all in the studio log.',
    triggers: [
      {
        type: 'collection-hook',
        parameters: { collectionSlug: 'bookings', hook: 'afterChange' },
        // Only the change into "paid" counts, so re-saving a paid booking (or seeding paid
        // bookings) does not run the workflow again.
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
        // Written by mailing's bookings hook, which runs before automation's in the same save.
        name: 'Find confirmation email',
        slug: 'find-confirmation-email',
        type: 'read-document',
        input: {
          collectionSlug: 'emails',
          where: {
            booking: { equals: '{{trigger.doc.id}}' },
            templateSlug: { equals: 'booking-confirmation' },
          },
          limit: 1,
          depth: 0,
        },
      },
      {
        // Written by notifyBookingStatus (src/lib/notifications.ts) in the same save.
        name: 'Find confirmation notification',
        slug: 'find-confirmation-notification',
        type: 'read-document',
        input: {
          collectionSlug: 'notifications',
          where: {
            booking: { equals: '{{trigger.doc.id}}' },
            event: { equals: 'booking-confirmed' },
          },
          limit: 1,
          depth: 0,
        },
      },
      {
        name: 'Find earlier tips',
        slug: 'find-earlier-tips',
        type: 'read-document',
        input: {
          collectionSlug: 'notifications',
          where: {
            booking: { equals: '{{trigger.doc.id}}' },
            channel: { equals: 'class-reminders' },
          },
          limit: 1,
          depth: 0,
        },
      },
      {
        // A step condition: a booking that is paid again later (after a cancellation) doesn't
        // get the tips twice.
        name: 'Send what-to-bring tips',
        slug: 'send-tips',
        type: 'create-document',
        dependencies: ['read-workshop', 'find-earlier-tips'],
        condition: 'steps.`Find earlier tips`.output.totalDocs = 0',
        input: {
          collectionSlug: 'notifications',
          data: {
            title: '{{"Getting ready for " & steps.`Read workshop`.output.doc.title}}',
            message: richText(
              '{{"Your class starts " & ' +
                studioDateExpr('steps.`Read session`.output.doc.startsAt') +
                ' & ". Wear clothes that can take a splash of slip, keep your nails short and ' +
                'tie back long hair. Aprons, tools and clay are on us."}}',
              'Arrive ten minutes early for tea and a spot at the wheel.',
            ),
            channel: 'class-reminders',
            recipient: `{{${relIdExpr('trigger.doc.member')}}}`,
            booking: '{{trigger.doc.id}}',
          },
        },
      },
      {
        name: 'Write studio log',
        slug: 'write-studio-log',
        type: 'create-document',
        dependencies: ['find-confirmation-email', 'find-confirmation-notification', 'send-tips'],
        input: {
          collectionSlug: 'studio-log',
          data: {
            title: '{{"Seat confirmed: " & steps.`Read workshop`.output.doc.title}}',
            // Public text: no member name, email or booking reference.
            message:
              '{{"A seat for " & ' +
              studioDateExpr('steps.`Read session`.output.doc.startsAt') +
              ' & " was confirmed. Confirmation email: " & ' +
              '(steps.`Find confirmation email`.output.totalDocs > 0 ? "queued by mailing" : "not found") & ' +
              '". Inbox message: " & ' +
              '(steps.`Find confirmation notification`.output.totalDocs > 0 ? "sent by notifications" : "not found") & ' +
              '". What-to-bring tips: " & ' +
              '(steps.`Send what-to-bring tips`.state = "succeeded" ? "sent" : "already sent earlier") & "."}}',
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
      'pager), post a "Studio news" notification to members and write a warning to the studio log ' +
      'with the pager ticket.',
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
      {
        // A broadcast (no recipient) on the notifications plugin's "Studio news" channel, shown in
        // the inbox of every member who follows it.
        name: 'Post studio news',
        slug: 'post-studio-news',
        type: 'create-document',
        dependencies: ['page-technician'],
        input: {
          collectionSlug: 'notifications',
          data: {
            title: '{{"Kiln update: " & $string(trigger.doc.kiln) & " is running hot"}}',
            message: richText(
              'Our kiln technician is checking it now. Pieces in this firing may be ready a day later than planned; we will let you know when they are out.',
            ),
            channel: 'studio-news',
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
  {
    slug: WORKFLOW_SLUGS.morningReport,
    name: 'Morning kiln-room report',
    description:
      'Every morning at 07:00 studio time (Europe/Amsterdam) a scheduled trigger looks at the ' +
      'day ahead: the classes starting in the next 24 hours and the bookings still waiting for ' +
      'payment. It writes the report to the studio log and emails it to the studio admins.',
    triggers: [
      {
        type: 'scheduled',
        parameters: { schedule: MORNING_REPORT_SCHEDULE, timezone: MORNING_REPORT_TIMEZONE },
      },
    ],
    steps: [
      {
        // The 24 hours from the occurrence being fired, not from when the job happened to run.
        name: 'Find classes today',
        slug: 'find-classes-today',
        type: 'read-document',
        input: {
          collectionSlug: 'sessions',
          where: {
            and: [
              { status: { equals: 'scheduled' } },
              { startsAt: { greater_than_equal: '{{trigger.scheduledAt}}' } },
              {
                startsAt: {
                  less_than: '{{$fromMillis($toMillis(trigger.scheduledAt) + 86400000)}}',
                },
              },
            ],
          },
          limit: 50,
          depth: 0,
        },
      },
      {
        name: 'Count pending bookings',
        slug: 'count-pending-bookings',
        type: 'read-document',
        input: {
          collectionSlug: 'bookings',
          where: { status: { equals: 'pending' } },
          limit: 1,
          depth: 0,
        },
      },
      {
        name: 'Find studio admins',
        slug: 'find-admins',
        type: 'read-document',
        input: {
          collectionSlug: 'users',
          where: { role: { equals: 'admin' } },
          limit: 10,
          depth: 0,
        },
      },
      {
        name: 'Write studio log',
        slug: 'write-studio-log',
        type: 'create-document',
        dependencies: ['find-classes-today', 'count-pending-bookings'],
        input: {
          collectionSlug: 'studio-log',
          data: {
            title:
              '{{"Morning report: " & $fromMillis($toMillis(trigger.scheduledAt), "[FNn] [D] [MNn]", "+0100")}}',
            // Public text: counts and class times only.
            message:
              '{{$string(steps.`Find classes today`.output.totalDocs) & ' +
              '(steps.`Find classes today`.output.totalDocs = 1 ? " class" : " classes") & ' +
              '" in the next 24 hours" & ' +
              '(steps.`Find classes today`.output.totalDocs > 0 ? " (" & $join(steps.`Find classes today`.output.doc.(' +
              studioDateExpr('startsAt') +
              '), ", ") & ")" : "") & ' +
              '"; " & $string(steps.`Count pending bookings`.output.totalDocs) & ' +
              '(steps.`Count pending bookings`.output.totalDocs = 1 ? " booking" : " bookings") & ' +
              '" waiting for payment."}}',
            source: 'schedule',
            severity: 'info',
          },
        },
      },
      {
        name: 'Email admins',
        slug: 'email-admins',
        type: 'send-email',
        dependencies: ['write-studio-log', 'find-admins'],
        condition: 'steps.`Find studio admins`.output.totalDocs > 0',
        input: {
          to: '{{$join(steps.`Find studio admins`.output.doc.email, ", ")}}',
          subject: '{{steps.`Write studio log`.output.doc.title}}',
          text: '{{steps.`Write studio log`.output.doc.message & "\\n\\nKiln & Co. automation"}}',
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
