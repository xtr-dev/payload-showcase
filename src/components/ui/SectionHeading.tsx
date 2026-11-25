import type { ReactNode } from 'react'

import { cn } from './cn'

/** Eyebrow + display heading + optional intro, used at the top of page sections. */
export const SectionHeading = ({
  eyebrow,
  title,
  intro,
  as: Tag = 'h2',
  align = 'left',
  className,
  id,
}: {
  eyebrow?: string
  title: ReactNode
  intro?: ReactNode
  as?: 'h1' | 'h2'
  align?: 'left' | 'center'
  className?: string
  id?: string
}) => (
  <div className={cn(align === 'center' && 'mx-auto max-w-2xl text-center', className)}>
    {eyebrow && (
      <p className="mb-3 text-sm font-semibold tracking-[0.14em] text-clay uppercase">{eyebrow}</p>
    )}
    <Tag
      id={id}
      className={cn(
        'text-ink',
        Tag === 'h1'
          ? 'text-4xl leading-[1.05] sm:text-5xl lg:text-6xl'
          : 'text-3xl leading-tight sm:text-4xl',
      )}
    >
      {title}
    </Tag>
    {intro && <div className="mt-4 text-lg leading-relaxed text-ink-soft">{intro}</div>}
  </div>
)
