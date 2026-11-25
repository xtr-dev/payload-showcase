'use server'

import { cookies } from 'next/headers'

import {
  EXPERIMENT_NAMES,
  isVariant,
  previewCookie,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE,
} from '@/lib/experiments'

/**
 * Server actions behind the feature-flags debug panel on /showcase. Setting cookies in a server
 * action makes Next.js re-render the page, so the panel and the header show the new state at once.
 */

/** Pins the homepage hero to variant `a` or `b` for this browser (not counted in the results). */
export async function previewHeroVariant(formData: FormData): Promise<void> {
  const variant = formData.get('variant')
  if (!isVariant(variant)) return
  ;(await cookies()).set(previewCookie('home-hero'), variant, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
}

/**
 * Drops every preview and gives the browser a fresh visitor id, so it is bucketed again for the
 * hero experiment and the visitor-based rollouts.
 */
export async function resetAssignment(): Promise<void> {
  const jar = await cookies()
  for (const experiment of EXPERIMENT_NAMES) jar.delete(previewCookie(experiment))
  jar.set(VISITOR_COOKIE, crypto.randomUUID(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: VISITOR_COOKIE_MAX_AGE,
  })
}
