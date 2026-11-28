import type { SeedWorkflow } from '@xtr-dev/payload-automation'
import type { Payload } from 'payload'

import { STUDIO_TIME_ZONE } from '@/lib/format'
import { richText } from '@/lib/richtext'

import type { SeedContext } from './types'

/**
 * The studio's code-defined workflows. `src/plugins/automation.ts` hands them to the plugin's
 * `seedWorkflows` option, which creates each one (with its triggers and steps) on boot, marks it
 * read-only in the admin panel and, when a definition here changes, updates the stored workflow in
 * place on the next boot (steps are matched by slug, so run history keeps pointing at them).
 *
 * Expression rules in payload-automation 0.6.0, which these definitions follow:
 * - A step input value is evaluated only when the whole string is wrapped in `{{ }}`, as one
 *   JSONata expression; anything else is a literal, so strings are built with JSONata's `&`
 *   operator inside a single expression.
 * - Earlier steps are read as ``steps.`<step slug>`.output`` and ``.state``. Steps are also
 *   keyed by their display name, but the slug stays stable when a step is renamed; hyphenated
 *   slugs need the backticks, or JSONata reads the `-` as subtraction.
 * - A read-document step returns the matching documents as `output.docs`, the first one (or the
 *   document read by `id`) as `output.doc`, and the number of matches as `output.totalDocs`.
 * - Every workflow declares `errorHandling: 'stop'` (a step that fails after its last attempt
 *   fails the run) and a `timeout` for the whole run, through `RUN_SETTINGS` below. Declared
 *   settings are restored on every boot, so they cannot drift from this file.
 * - A step retries only when it declares `retryOnFailure` with its own `maxRetries` and
 *   `retryDelay`; the kiln alert's pager call is the one step that does (see KILN_PAGER_RETRY).
 * - `discardRunWhen` is a bare JSONata expression evaluated when a run finishes without a failed
 *   step; when it is true the run is deleted instead of stored. "Release unpaid orders" uses it.
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
  orderPaid: 'shop-order-paid',
  releaseUnpaidOrders: 'release-unpaid-orders',
} as const

/** Slug of the studio digest's email step, whose result src/lib/automation.ts reads. */
export const STUDIO_DIGEST_EMAIL_STEP = 'email-digest'

/**
 * Jobs queue of the plugin's scheduled-triggers task. src/plugins/automation.ts registers the task
 * on it and runs it every minute.
 */
export const AUTOMATION_QUEUE = 'automation'

/** When the morning report runs: every day at 07:00, in MORNING_REPORT_TIMEZONE. */
export const MORNING_REPORT_SCHEDULE = '0 7 * * *'

/** The studio's timezone, which the morning report's schedule is evaluated in. */
export const MORNING_REPORT_TIMEZONE = STUDIO_TIME_ZONE

/**
 * When unpaid shop orders are looked for: every minute. An order is released once it has waited
 * UNPAID_ORDER_MINUTES, so within about a minute of that. Checking this often is affordable
 * because a run that released nothing is not stored (see the workflow's `discardRunWhen`).
 */
export const RELEASE_UNPAID_ORDERS_SCHEDULE = '* * * * *'

/** How long a shop order may wait for its payment (STALE_ORDER_MINUTES in src/lib/shop.ts). */
export const UNPAID_ORDER_MINUTES = 30

/**
 * Slug of the custom step that cancels unpaid orders (CancelStaleOrdersStepTask in
 * src/plugins/ecommerce.ts, which the plugin config registers).
 */
const CANCEL_STALE_ORDERS_STEP = 'cancel-stale-orders'

/** Slug of the kiln alert's HTTP step, which calls the pager and is retried when that fails. */
export const KILN_PAGER_STEP = 'page-technician'

/**
 * Retry settings of the kiln alert's pager call. Paging the technician is a call to another
 * service, the one step here that can fail for a moment and work a second later, so it is tried
 * again: `maxRetries` retries after the first attempt (2 means up to 3 attempts), with a fixed
 * `retryDelay` in milliseconds between them. The step only counts as failed, and fails the run,
 * after its last attempt.
 */
export const KILN_PAGER_RETRY = { retryOnFailure: true, maxRetries: 2, retryDelay: 500 } as const

/**
 * Run settings every seeded workflow declares. `stop`: a step that fails after its last attempt
 * fails the run, and no later step starts. `timeout`: a whole run, retries included, may take
 * one minute; every workflow here is a handful of database reads and writes and at most one
 * HTTP call or email, so a run that takes longer is stuck.
 */
const RUN_SETTINGS = { errorHandling: 'stop', timeout: 60_000 } as const

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

/**
 * JSONata for how many units of a product (the context item) are left: the scarcest glaze for a
 * product with variants, which keep their own stock, and the product's own quantity otherwise.
 */
const STOCK_LEFT_EXPR = '($count(variants) > 0 ? $min(variants.inventory) : inventory.quantity)'

/**
 * JSONata for the products of the paid order that are at or under their low-stock threshold.
 * A product without a threshold (or with 0) never counts as low.
 */
const LOW_STOCK_EXPR =
  'steps.`read-products`.output.docs[inventory.trackQuantity = true and ' +
  `${STOCK_LEFT_EXPR} <= (inventory.lowStockThreshold ? inventory.lowStockThreshold : -1)]`

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
          id: `{{${relIdExpr('steps.`read-session`.output.doc.workshop')}}}`,
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
        condition: 'steps.`find-earlier-tips`.output.totalDocs = 0',
        input: {
          collectionSlug: 'notifications',
          data: {
            title: '{{"Getting ready for " & steps.`read-workshop`.output.doc.title}}',
            message: richText(
              '{{"Your class starts " & ' +
                studioDateExpr('steps.`read-session`.output.doc.startsAt') +
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
            title: '{{"Seat confirmed: " & steps.`read-workshop`.output.doc.title}}',
            // Public text: no member name, email or booking reference.
            message:
              '{{"A seat for " & ' +
              studioDateExpr('steps.`read-session`.output.doc.startsAt') +
              ' & " was confirmed. Confirmation email: " & ' +
              '(steps.`find-confirmation-email`.output.totalDocs > 0 ? "queued by mailing" : "not found") & ' +
              '". Inbox message: " & ' +
              '(steps.`find-confirmation-notification`.output.totalDocs > 0 ? "sent by notifications" : "not found") & ' +
              '". What-to-bring tips: " & ' +
              '(steps.`send-tips`.state = "succeeded" ? "sent" : "already sent earlier") & "."}}',
            source: 'booking',
            severity: 'info',
            booking: '{{trigger.doc.id}}',
          },
        },
      },
    ],
    ...RUN_SETTINGS,
  },
  {
    slug: WORKFLOW_SLUGS.kilnAlert,
    name: 'Kiln temperature alert',
    description:
      'The kiln controller posts its readings to a webhook. Readings at or above ' +
      `${KILN_ALERT_THRESHOLD_C} °C page the kiln technician (an HTTP request to the site's mock ` +
      'pager, retried up to twice when the pager does not answer), post a "Studio news" notification to members and write a warning to the studio log ' +
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
        // Retried up to twice when the pager does not answer.
        name: 'Page kiln technician',
        slug: KILN_PAGER_STEP,
        type: 'http-request-step',
        ...KILN_PAGER_RETRY,
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
              '{{"Paged " & steps.`page-technician`.output.data.onCall & " (ticket " & steps.`page-technician`.output.data.ticket & ")."}}',
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
    ...RUN_SETTINGS,
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
    ...RUN_SETTINGS,
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
              '{{$string(steps.`count-bookings`.output.totalDocs) & " confirmed bookings and " & $string(steps.`count-log`.output.totalDocs) & " earlier log entries."}}',
            source: 'manual',
            severity: 'info',
          },
        },
      },
      {
        name: 'Email digest',
        slug: STUDIO_DIGEST_EMAIL_STEP,
        type: 'send-email',
        dependencies: ['write-studio-log'],
        input: {
          to: '{{trigger.data.sendTo}}',
          subject: 'Kiln & Co. studio digest',
          text: '{{steps.`write-studio-log`.output.doc.message}}',
        },
      },
    ],
    ...RUN_SETTINGS,
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
              '{{$string(steps.`find-classes-today`.output.totalDocs) & ' +
              '(steps.`find-classes-today`.output.totalDocs = 1 ? " class" : " classes") & ' +
              '" in the next 24 hours" & ' +
              '(steps.`find-classes-today`.output.totalDocs > 0 ? " (" & $join(steps.`find-classes-today`.output.docs.(' +
              studioDateExpr('startsAt') +
              '), ", ") & ")" : "") & ' +
              '"; " & $string(steps.`count-pending-bookings`.output.totalDocs) & ' +
              '(steps.`count-pending-bookings`.output.totalDocs = 1 ? " booking" : " bookings") & ' +
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
        condition: 'steps.`find-admins`.output.totalDocs > 0',
        input: {
          to: '{{$join(steps.`find-admins`.output.docs.email, ", ")}}',
          subject: '{{steps.`write-studio-log`.output.doc.title}}',
          text: '{{steps.`write-studio-log`.output.doc.message & "\\n\\nKiln & Co. automation"}}',
        },
      },
    ],
    ...RUN_SETTINGS,
  },
  {
    slug: WORKFLOW_SLUGS.orderPaid,
    name: 'Shop order paid',
    description:
      'When a shop order is paid, billing has marked it paid and mailing has queued the ' +
      'confirmation email. This workflow looks at the stock that is left: it records the sale ' +
      'in the studio log and, when a product in the order is down to its low-stock threshold, ' +
      'tells the studio admin in their inbox.',
    triggers: [
      {
        type: 'collection-hook',
        parameters: { collectionSlug: 'orders', hook: 'afterChange' },
        // Only the change into "paid", so shipping or refunding the order later does not run it.
        condition:
          'trigger.operation = "update" and trigger.doc.paymentStatus = "paid" and trigger.previousDoc.paymentStatus != "paid"',
      },
    ],
    steps: [
      {
        // The array constructor keeps a one-line order's single id an array for `in`.
        name: 'Read ordered products',
        slug: 'read-products',
        type: 'read-document',
        input: {
          collectionSlug: 'products',
          where: { id: { in: `{{[trigger.doc.items.${relIdExpr('product')}]}}` } },
          limit: 50,
          depth: 0,
        },
      },
      {
        name: 'Find studio admin',
        slug: 'find-admin',
        type: 'read-document',
        input: {
          collectionSlug: 'users',
          where: { role: { equals: 'admin' } },
          limit: 1,
          depth: 0,
        },
      },
      {
        name: 'Write studio log',
        slug: 'write-studio-log',
        type: 'create-document',
        dependencies: ['read-products'],
        input: {
          collectionSlug: 'studio-log',
          data: {
            title:
              '{{"Shop order paid: " & $string($sum(trigger.doc.items.quantity)) & ' +
              '($sum(trigger.doc.items.quantity) = 1 ? " piece" : " pieces")}}',
            // Public text: what was sold and what is running low, never who bought it.
            message:
              '{{"Sold: " & $join(steps.`read-products`.output.docs.title, ", ") & ". Low on stock now: " & ' +
              `($count(${LOW_STOCK_EXPR}) > 0 ? $join(${LOW_STOCK_EXPR}.title, ", ") : "nothing") & "."}}`,
            source: 'order',
            severity: `{{$count(${LOW_STOCK_EXPR}) > 0 ? "warning" : "info"}}`,
          },
        },
      },
      {
        name: 'Warn admin about low stock',
        slug: 'warn-low-stock',
        type: 'create-document',
        dependencies: ['read-products', 'find-admin'],
        condition: `$count(${LOW_STOCK_EXPR}) > 0 and steps.\`find-admin\`.output.totalDocs > 0`,
        input: {
          collectionSlug: 'notifications',
          data: {
            title: 'Low stock in the shop',
            message: richText(
              `{{"After order " & trigger.doc.orderNumber & ": " & $join(${LOW_STOCK_EXPR}.(title & " (" & $string(${STOCK_LEFT_EXPR}) & " left)"), ", ") & "."}}`,
            ),
            channel: 'orders',
            recipient: '{{steps.`find-admin`.output.doc.id}}',
            order: '{{trigger.doc.id}}',
          },
        },
      },
    ],
    ...RUN_SETTINGS,
  },
  {
    slug: WORKFLOW_SLUGS.releaseUnpaidOrders,
    name: 'Release unpaid orders',
    description:
      'A shop order holds its stock from the moment it is placed. Every minute a scheduled ' +
      `trigger runs a custom step that cancels orders left unpaid for ${UNPAID_ORDER_MINUTES} ` +
      'minutes; the ecommerce plugin then puts their items back on the shelf. The studio log ' +
      'gets an entry when something was released, and a run that released nothing is not kept ' +
      'in the run history.',
    triggers: [
      {
        type: 'scheduled',
        parameters: { schedule: RELEASE_UNPAID_ORDERS_SCHEDULE, timezone: STUDIO_TIME_ZONE },
      },
    ],
    steps: [
      {
        name: 'Cancel unpaid orders',
        slug: 'cancel-unpaid-orders',
        type: CANCEL_STALE_ORDERS_STEP,
        input: { olderThanMinutes: UNPAID_ORDER_MINUTES },
      },
      {
        name: 'Write studio log',
        slug: 'write-studio-log',
        type: 'create-document',
        dependencies: ['cancel-unpaid-orders'],
        condition: 'steps.`cancel-unpaid-orders`.output.cancelled > 0',
        input: {
          collectionSlug: 'studio-log',
          data: {
            title:
              '{{"Released " & $string(steps.`cancel-unpaid-orders`.output.cancelled) & ' +
              '(steps.`cancel-unpaid-orders`.output.cancelled = 1 ? " unpaid order" : " unpaid orders")}}',
            message: `Unpaid for more than ${UNPAID_ORDER_MINUTES} minutes, so the items are back on the shelf.`,
            source: 'order',
            severity: 'info',
          },
        },
      },
    ],
    ...RUN_SETTINGS,
    // Most minutes there is nothing to release. Storing those runs would bury the ones that did
    // something, so only a run that cancelled at least one order stays in the history. A failed
    // run is always kept.
    discardRunWhen: 'steps.`cancel-unpaid-orders`.output.cancelled = 0',
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
