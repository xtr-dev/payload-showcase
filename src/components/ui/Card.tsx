import type { ComponentProps } from 'react'

import { cn } from './cn'

type CardProps = ComponentProps<'div'> & {
  tone?: 'paper' | 'bisque' | 'white'
  /** Use `section` when the card has its own heading, so it becomes a labelled landmark. */
  as?: 'div' | 'section' | 'article' | 'aside'
}

const tones = {
  paper: 'bg-paper',
  bisque: 'bg-bisque',
  white: 'bg-white/70',
}

export const Card = ({ tone = 'white', as: Tag = 'div', className, ...props }: CardProps) => (
  <Tag
    className={cn('rounded-card border border-line/70 shadow-card', tones[tone], className)}
    {...props}
  />
)
