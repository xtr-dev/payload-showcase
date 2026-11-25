import type { Media, Workshop } from '@/payload-types'

/** The studio's time zone. Dates are always shown in studio time, wherever the server runs. */
export const STUDIO_TIME_ZONE = 'Europe/Amsterdam'

export const formatPrice = (cents: number | null | undefined, currency = 'EUR'): string =>
  new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents && cents % 100 !== 0 ? 2 : 0,
  }).format((cents ?? 0) / 100)

export const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: STUDIO_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))

export const formatTime = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: STUDIO_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

export const formatDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

export const LEVEL_LABELS: Record<Workshop['level'], string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  all: 'All levels',
}

export const FORMAT_LABELS: Record<Workshop['format'], string> = {
  'one-off': 'One-off class',
  course: 'Course',
}

/** Returns the populated media document, or null when the relation is only an id. */
export const asMedia = (value: number | Media | null | undefined): Media | null =>
  value && typeof value === 'object' ? value : null
