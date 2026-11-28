import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * The shared Payload instance for server components, server actions and route handlers.
 *
 * The instance itself is created when the server starts, by src/instrumentation.ts, which also
 * starts the `jobs.autoRun` crons (mail, billing and the automation scheduler). `cron: true` is
 * repeated here so the crons also start where `register` has not run, such as a page rendered
 * outside the Next.js server; Payload starts them once per process, so asking twice is harmless.
 */
export const getPayloadClient = () => getPayload({ config, cron: true })
