import type { ReactNode } from 'react'

import { cn } from './cn'

export type BadgeTone = 'neutral' | 'clay' | 'glaze' | 'success' | 'warning' | 'danger'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-sand/70 text-ink',
  clay: 'bg-clay-soft text-clay-deep',
  glaze: 'bg-glaze-soft text-glaze-deep',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
}

export const Badge = ({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-pill px-3 py-1 text-xs font-semibold tracking-wide',
      tones[tone],
      className,
    )}
  >
    {children}
  </span>
)
