import config from '@payload-config'
import { getPayload } from 'payload'

/** The shared Payload instance for server components, server actions and route handlers. */
export const getPayloadClient = () => getPayload({ config })
