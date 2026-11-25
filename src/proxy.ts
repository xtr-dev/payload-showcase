import { NextResponse, type NextRequest } from 'next/server'

import { VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE } from '@/lib/experiments'

/**
 * Gives every browser a random visitor id (`kiln_vid`) on its first page view. Feature-flag
 * experiments and rollouts bucket on it (see src/lib/flags.ts), which keeps a visitor's homepage
 * hero variant the same across visits. Server components cannot set cookies, so this runs as the
 * Next.js proxy; the new id is also written into the forwarded request so the very first render
 * already sees it.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.get(VISITOR_COOKIE)?.value) return NextResponse.next()

  const visitorId = crypto.randomUUID()
  request.cookies.set(VISITOR_COOKIE, visitorId)
  const response = NextResponse.next({ request: { headers: request.headers } })
  response.cookies.set(VISITOR_COOKIE, visitorId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: VISITOR_COOKIE_MAX_AGE,
  })
  return response
}

export const config = {
  // Site pages only: not the Payload admin and API, Next.js assets, or files with an extension.
  matcher: ['/((?!api|admin|_next|.*\\..*).*)'],
}
