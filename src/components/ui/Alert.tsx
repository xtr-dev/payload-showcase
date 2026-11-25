import type { ReactNode } from 'react'

import { cn } from './cn'

const tones = {
  success: 'border-success/30 bg-success-soft text-success',
  info: 'border-cobalt/25 bg-glaze-soft text-glaze-deep',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
}

export const Alert = ({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof tones
  title?: string
  children?: ReactNode
  className?: string
}) => (
  <div
    role={tone === 'danger' ? 'alert' : 'status'}
    className={cn('rounded-xl border px-4 py-3 text-sm', tones[tone], className)}
  >
    {title && <p className="font-semibold">{title}</p>}
    {children && <div className={cn(title && 'mt-1')}>{children}</div>}
  </div>
)
