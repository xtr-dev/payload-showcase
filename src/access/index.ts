import type { Access, FieldAccess, PayloadRequest } from 'payload'

import type { User } from '@/payload-types'

/** Narrows `req.user` to a site user (the `users` auth collection). */
export const getUser = (req: PayloadRequest): User | null =>
  req.user && req.user.collection === 'users' ? (req.user as User) : null

export const isAdminUser = (user: Pick<User, 'role'> | null | undefined): boolean =>
  user?.role === 'admin'

export const isAdmin: Access = ({ req }) => isAdminUser(getUser(req))

export const isAdminField: FieldAccess = ({ req }) => isAdminUser(getUser(req))

export const isLoggedIn: Access = ({ req }) => Boolean(getUser(req))

export const anyone: Access = () => true

/** Admins see every user; members see only their own user document. */
export const adminOrSelf: Access = ({ req }) => {
  const user = getUser(req)
  if (!user) return false
  if (isAdminUser(user)) return true
  return { id: { equals: user.id } }
}

/** Admins see everything, including drafts; everyone else only sees published documents. */
export const publishedOrAdmin: Access = ({ req }) => {
  if (isAdminUser(getUser(req))) return true
  return { _status: { equals: 'published' } }
}
