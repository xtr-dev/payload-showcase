import type { Booking, MembershipPlan, Session, User, Workshop } from '@/payload-types'

/**
 * Everything the core seed created. Plugin seeds (src/seed/<plugin>.ts) receive this so they can
 * attach their own data (payments, emails, notifications, ...) to the same users and bookings.
 */
export interface SeedContext {
  admin: User
  members: User[]
  workshops: Workshop[]
  sessions: Session[]
  bookings: Booking[]
  plans: MembershipPlan[]
}
