import { serviceWorkerCode } from '@xtr-dev/payload-notifications/client'

/**
 * Serves the plugin's push service worker at /sw.js (the path its ClientPushManager registers).
 * It must be served from the site root so its scope covers every page.
 */
export const GET = () =>
  new Response(serviceWorkerCode, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    },
  })
