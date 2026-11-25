'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Re-renders the return page every couple of seconds while the provider has not yet reported
 * the outcome (a webhook, or the test provider's delayed callback). Stops after two minutes.
 */
export const ReturnPoller = ({ intervalMs = 1500 }: { intervalMs?: number }) => {
  const router = useRouter()
  useEffect(() => {
    let ticks = 0
    const timer = window.setInterval(() => {
      ticks += 1
      if (ticks * intervalMs > 120_000) window.clearInterval(timer)
      else router.refresh()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [router, intervalMs])
  return null
}
