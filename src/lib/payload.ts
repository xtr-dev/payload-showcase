import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * The shared Payload instance for server components, server actions and route handlers.
 *
 * `cron: true` starts the `jobs.autoRun` crons (mail, billing and the automation scheduler) on the
 * first page request. Without it they only start once something calls getPayload with crons
 * enabled, such as the admin panel, so scheduled workflows and queued emails would wait for an
 * admin visit after every server start. Payload starts the crons once per process.
 */
export const getPayloadClient = () => getPayload({ config, cron: true })
