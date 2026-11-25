import type { ReactNode } from 'react'

import { Spiral } from '@/components/art/Decor'
import { Card, Container } from '@/components/ui'

/** Two-column frame shared by the sign-in and registration pages. */
export const AuthShell = ({
  title,
  intro,
  children,
}: {
  title: string
  intro: ReactNode
  children: ReactNode
}) => (
  <Container className="grid items-center gap-12 py-14 lg:grid-cols-2 lg:py-24">
    <div className="relative">
      <Spiral className="mb-6 h-16 w-16 text-ochre" />
      <h1 className="text-4xl text-ink sm:text-5xl">{title}</h1>
      <div className="mt-4 max-w-md text-lg text-ink-soft">{intro}</div>
    </div>
    <Card className="p-6 sm:p-10">{children}</Card>
  </Container>
)
