import type { ComponentProps, ReactNode } from 'react'

import { cn } from './cn'

const control =
  'block w-full rounded-xl border-2 border-line bg-white/80 px-4 py-2.5 text-ink placeholder:text-ink-soft/60 transition-colors hover:border-ink-soft/50 focus:border-cobalt focus:outline-none focus-visible:outline-none focus:ring-4 focus:ring-cobalt/20 aria-invalid:border-danger'

type FieldShellProps = {
  id: string
  label: string
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
}

/** Label, control, hint and error text, wired together with ids for screen readers. */
export const FieldShell = ({ id, label, hint, error, children, className }: FieldShellProps) => (
  <div className={cn('space-y-1.5', className)}>
    <label htmlFor={id} className="block text-sm font-semibold text-ink">
      {label}
    </label>
    {children}
    {hint && !error && (
      <p id={`${id}-hint`} className="text-sm text-ink-soft">
        {hint}
      </p>
    )}
    {error && (
      <p id={`${id}-error`} className="text-sm font-medium text-danger">
        {error}
      </p>
    )}
  </div>
)

type InputProps = ComponentProps<'input'> & {
  id: string
  label: string
  hint?: ReactNode
  error?: string
}

export const TextField = ({ id, label, hint, error, className, ...props }: InputProps) => (
  <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
    <input
      id={id}
      name={props.name ?? id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      className={control}
      {...props}
    />
  </FieldShell>
)

type SelectProps = ComponentProps<'select'> & { id: string; label: string; hint?: ReactNode }

export const SelectField = ({ id, label, hint, className, children, ...props }: SelectProps) => (
  <FieldShell id={id} label={label} hint={hint} className={className}>
    <select
      id={id}
      name={props.name ?? id}
      aria-describedby={hint ? `${id}-hint` : undefined}
      className={cn(
        control,
        'appearance-none bg-[length:1rem] bg-[right_1rem_center] bg-no-repeat pr-10',
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3 6l5 5 5-5' fill='none' stroke='%235b4637' stroke-width='2'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  </FieldShell>
)

type TextAreaProps = ComponentProps<'textarea'> & { id: string; label: string; hint?: ReactNode }

export const TextAreaField = ({ id, label, hint, className, ...props }: TextAreaProps) => (
  <FieldShell id={id} label={label} hint={hint} className={className}>
    <textarea
      id={id}
      name={props.name ?? id}
      aria-describedby={hint ? `${id}-hint` : undefined}
      className={cn(control, 'min-h-28')}
      {...props}
    />
  </FieldShell>
)
