'use client'

import { useEffect, useRef } from 'react'

import type { ExperimentName } from '@/lib/experiments'

const TRACK_URL = '/api/experiment-events/track'

/**
 * Sends an experiment event to the tracking endpoint. `sendBeacon` survives the navigation that a
 * call-to-action click starts; `fetch` with `keepalive` is the fallback.
 */
const track = (experiment: ExperimentName, type: 'exposure' | 'conversion') => {
  const body = JSON.stringify({ experiment, type })
  if (navigator.sendBeacon?.(TRACK_URL, new Blob([body], { type: 'application/json' }))) return
  void fetch(TRACK_URL, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
  }).catch(() => {})
}

/**
 * Records an exposure when the homepage hero renders and a conversion when its call to action is
 * clicked. Rendered inside the hero section; it watches clicks on links to `ctaHref` within the
 * closest `[data-hero-variant]` element. The server decides the variant and ignores previews.
 */
export const HeroExperimentTracker = ({
  experiment,
  ctaHref,
}: {
  experiment: ExperimentName
  ctaHref?: string | null
}) => {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    track(experiment, 'exposure')
    const section = ref.current?.closest('[data-hero-variant]')
    if (!section || !ctaHref) return
    const onClick = (event: Event) => {
      const link = (event.target as Element | null)?.closest('a')
      if (link && link.getAttribute('href') === ctaHref) track(experiment, 'conversion')
    }
    section.addEventListener('click', onClick)
    return () => section.removeEventListener('click', onClick)
  }, [experiment, ctaHref])

  return <span ref={ref} hidden />
}
