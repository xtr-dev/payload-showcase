import Link from 'next/link'

import { Container } from '@/components/ui'
import { getPayloadClient } from '@/lib/payload'

import { LogoMark } from './Logo'

export const SiteFooter = async () => {
  const payload = await getPayloadClient()
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })

  return (
    <footer className="grain mt-24 bg-ink text-paper/85">
      <svg
        aria-hidden
        viewBox="0 0 1200 40"
        preserveAspectRatio="none"
        className="block h-6 w-full -translate-y-px fill-paper"
      >
        <path d="M0 0h1200v12c-120 18-260 26-400 14S520 4 400 12 140 34 0 18Z" />
      </svg>
      <Container className="grid gap-12 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5 text-paper">
            <LogoMark className="h-9 w-9 text-ochre" />
            <span className="font-display text-2xl font-semibold">{settings.siteName}</span>
          </div>
          {settings.tagline && <p className="mt-4 max-w-xs text-paper/75">{settings.tagline}</p>}
        </div>

        <div>
          <h2 className="font-sans text-sm font-semibold tracking-[0.14em] text-ochre uppercase">
            Visit
          </h2>
          {settings.contact?.address && (
            <address className="mt-4 whitespace-pre-line not-italic">
              {settings.contact.address}
            </address>
          )}
          {settings.contact?.email && (
            <a
              className="mt-2 block underline-offset-4 hover:text-white hover:underline"
              href={`mailto:${settings.contact.email}`}
            >
              {settings.contact.email}
            </a>
          )}
        </div>

        <div>
          <h2 className="font-sans text-sm font-semibold tracking-[0.14em] text-ochre uppercase">
            Opening hours
          </h2>
          <dl className="mt-4 space-y-1.5">
            {settings.openingHours?.map((row) => (
              <div key={row.id ?? row.days} className="flex justify-between gap-4">
                <dt>{row.days}</dt>
                <dd className="text-paper/70">{row.hours}</dd>
              </div>
            ))}
          </dl>
        </div>

        <nav aria-label="Footer">
          <h2 className="font-sans text-sm font-semibold tracking-[0.14em] text-ochre uppercase">
            Studio
          </h2>
          <ul className="mt-4 space-y-1.5">
            {[
              ['/workshops', 'Workshops'],
              ['/membership', 'Membership'],
              ['/account', 'My studio'],
              ['/showcase', 'Plugin showcase'],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="underline-offset-4 hover:text-white hover:underline">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
      <Container className="flex flex-col gap-2 border-t border-paper/15 py-6 text-sm text-paper/60 sm:flex-row sm:justify-between">
        <p>Kiln &amp; Co. is a fictional studio: a demo of the xtr-dev Payload CMS plugins.</p>
        <p>
          <a
            href="https://github.com/xtr-dev/payload-showcase"
            className="underline-offset-4 hover:text-white hover:underline"
          >
            Source on GitHub
          </a>
        </p>
      </Container>
    </footer>
  )
}
