import type { ReactNode } from 'react'

import { Badge, Container } from '@/components/ui'

export interface ShowcaseSectionProps {
  /** Anchor id, e.g. `billing`. */
  id: string
  /** npm package name. */
  pkg: string
  title: string
  /** One-sentence pitch. */
  intro: string
  /** Where the plugin shows up on the site, as [label, href] pairs. */
  usedOn: Array<[label: string, href: string]>
  /** Feature bullets. */
  features: string[]
  status: 'planned' | 'live'
  /** The live demo (phase 2) or a placeholder. */
  children: ReactNode
  tone?: 'paper' | 'bisque'
}

/** Shared frame for one plugin on the /showcase page. Plugin sections render inside it. */
export const ShowcaseSection = ({
  id,
  pkg,
  title,
  intro,
  usedOn,
  features,
  status,
  children,
  tone = 'paper',
}: ShowcaseSectionProps) => (
  <section
    id={id}
    aria-labelledby={`${id}-heading`}
    className={`scroll-mt-8 border-t border-line py-16 lg:py-20 ${tone === 'bisque' ? 'bg-bisque' : ''}`}
    data-plugin={pkg}
  >
    <Container className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-ink px-2 py-1 font-mono text-sm text-paper">{pkg}</code>
          <Badge tone={status === 'live' ? 'success' : 'warning'}>
            {status === 'live' ? 'Live' : 'Coming soon'}
          </Badge>
        </div>
        <h2 id={`${id}-heading`} className="mt-4 text-3xl text-ink sm:text-4xl">
          {title}
        </h2>
        <p className="mt-3 text-lg text-ink-soft">{intro}</p>
        <ul className="prose-kiln mt-6">
          {features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        {usedOn.length > 0 && (
          <p className="mt-6 text-sm text-ink-soft">
            See it on:{' '}
            {usedOn.map(([label, href], i) => (
              <span key={href}>
                {i > 0 && ', '}
                <a
                  href={href}
                  className="font-semibold text-clay underline-offset-4 hover:underline"
                >
                  {label}
                </a>
              </span>
            ))}
          </p>
        )}
      </div>
      <div>{children}</div>
    </Container>
  </section>
)
