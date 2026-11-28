/**
 * Starts Payload, and with it the `jobs.autoRun` crons, when the Next.js server starts.
 *
 * Payload only starts those crons when it is loaded with `cron: true`. Without this file that
 * first happens on the first page request (src/lib/payload.ts) or admin visit, so after a restart
 * queued emails, pending refunds and scheduled workflows would wait for a visitor. Unpaid shop
 * orders in particular must be released on time whether or not anyone is browsing.
 *
 * Next.js calls `register` once per server process, before it handles requests. Later
 * `getPayload` calls in the same process reuse the instance created here.
 */
export async function register() {
  // Payload needs Node.js; `register` also runs in the Edge runtime, where it must do nothing.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { getPayload } = await import('payload')
  const { default: config } = await import('@payload-config')
  await getPayload({ config, cron: true })
}
