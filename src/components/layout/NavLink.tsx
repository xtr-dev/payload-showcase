'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { cn } from '@/components/ui'

/** Navigation link that marks the current section with aria-current. */
export const NavLink = ({
  href,
  children,
  className,
}: {
  href: string
  children: ReactNode
  className?: string
}) => {
  const pathname = usePathname()
  const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`))
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative rounded-md px-1 py-1 font-medium text-ink-soft transition-colors hover:text-ink aria-[current=page]:text-ink',
        "after:absolute after:inset-x-1 after:-bottom-0.5 after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:bg-clay after:transition-transform after:content-[''] hover:after:scale-x-100 aria-[current=page]:after:scale-x-100",
        className,
      )}
    >
      {children}
    </Link>
  )
}
