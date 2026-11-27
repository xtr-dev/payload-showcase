import type { Metadata } from 'next'

import { Container } from '@/components/ui'

import { AutomationShowcase } from './sections/Automation'
import { BillingShowcase } from './sections/Billing'
import { EcommerceShowcase } from './sections/Ecommerce'
import { FeatureFlagsShowcase } from './sections/FeatureFlags'
import { MailingShowcase } from './sections/Mailing'
import { NotificationsShowcase } from './sections/Notifications'

export const metadata: Metadata = {
  title: 'Plugin showcase',
  description: 'Which xtr-dev Payload CMS plugin powers which part of the Kiln & Co. demo site.',
}

const SECTIONS = [
  { id: 'billing', label: 'Billing', Component: BillingShowcase },
  { id: 'mailing', label: 'Mailing', Component: MailingShowcase },
  { id: 'notifications', label: 'Notifications', Component: NotificationsShowcase },
  { id: 'feature-flags', label: 'Feature flags', Component: FeatureFlagsShowcase },
  { id: 'automation', label: 'Automation', Component: AutomationShowcase },
  { id: 'ecommerce', label: 'Shop', Component: EcommerceShowcase },
]

export default function ShowcasePage() {
  return (
    <>
      <section className="grain bg-ink text-paper">
        <Container className="py-16 lg:py-24">
          <p className="text-sm font-semibold tracking-[0.14em] text-ochre uppercase">
            Behind the glaze
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
            A real studio site, built from Payload plugins.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-paper/80">
            Kiln &amp; Co. is a fictional pottery studio. Everything that isn’t pages and classes
            (payments, email, notifications, experiments, workflows and the shop) comes from an
            open-source xtr-dev plugin for Payload CMS.
          </p>
          <nav aria-label="Plugins" className="mt-10">
            <ul className="flex flex-wrap gap-2">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="inline-flex h-10 items-center rounded-pill border border-paper/30 px-4 text-sm font-semibold hover:bg-paper hover:text-ink"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </section>
      {SECTIONS.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  )
}
