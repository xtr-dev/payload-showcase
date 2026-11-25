import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PluginPlaceholder } from '@/components/PluginPlaceholder'
import { Container, SectionHeading } from '@/components/ui'
import { isEnabled } from '@/lib/flags'
import { formatPrice } from '@/lib/format'

export const metadata: Metadata = { title: 'Gift cards' }

/** Gated by the `gift-cards` feature flag: returns 404 while the flag is off. */
export default async function GiftCardsPage() {
  if (!(await isEnabled('gift-cards'))) notFound()
  return (
    <Container className="py-14 lg:py-20">
      <SectionHeading
        as="h1"
        eyebrow="Gift cards"
        title="Give someone an evening at the wheel"
        intro="Gift cards can be used for any workshop or membership and are valid for a year."
      />
      <ul className="mt-10 grid gap-6 sm:grid-cols-3">
        {[5000, 7500, 15000].map((amount) => (
          <li key={amount} className="rounded-card bg-clay p-8 text-white shadow-card">
            <p className="font-display text-4xl">{formatPrice(amount)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-10">
        <PluginPlaceholder plugin="@xtr-dev/payload-billing">
          Buying a gift card goes through checkout once billing is wired in.
        </PluginPlaceholder>
      </div>
    </Container>
  )
}
