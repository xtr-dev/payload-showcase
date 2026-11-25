import Link from 'next/link'
import type { ComponentProps } from 'react'

import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'light'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-pill font-semibold tracking-tight whitespace-nowrap transition duration-200 ease-out-soft disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-clay text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] hover:bg-clay-deep active:translate-y-px',
  secondary:
    'bg-glaze text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] hover:bg-glaze-deep active:translate-y-px',
  outline: 'border-2 border-ink/80 text-ink hover:bg-ink hover:text-paper',
  ghost: 'text-ink hover:bg-ink/5',
  light: 'bg-paper text-ink hover:bg-white',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-6 text-[0.95rem]',
  lg: 'h-13 px-8 text-base',
}

export const buttonClasses = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md') =>
  cn(base, variants[variant], sizes[size])

type ButtonProps = ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }

export const Button = ({ variant, size, className, type = 'button', ...props }: ButtonProps) => (
  <button type={type} className={cn(buttonClasses(variant, size), className)} {...props} />
)

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }

export const ButtonLink = ({ variant, size, className, ...props }: ButtonLinkProps) => (
  <Link className={cn(buttonClasses(variant, size), className)} {...props} />
)
