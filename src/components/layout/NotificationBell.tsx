import type { User } from '@/payload-types'

/**
 * Header slot for the member's notification inbox (unread count + link to /account#notifications).
 *
 * Phase 2 (notifications) owns this file. Renders nothing until the plugin is wired in.
 */
export const NotificationBell = async (_props: { user: User }) => null
