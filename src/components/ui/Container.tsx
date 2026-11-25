import type { ComponentProps } from 'react'

import { cn } from './cn'

export const Container = ({
  className,
  narrow,
  ...props
}: ComponentProps<'div'> & { narrow?: boolean }) => (
  <div
    className={cn('mx-auto w-full px-5 sm:px-8', narrow ? 'max-w-3xl' : 'max-w-6xl', className)}
    {...props}
  />
)
