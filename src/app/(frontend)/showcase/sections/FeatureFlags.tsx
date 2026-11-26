import { getFeatureFlag } from '@xtr-dev/payload-feature-flags/rsc'
import Link from 'next/link'

import { FlagDebugPanel } from '@/components/flags/FlagDebugPanel'
import { Card } from '@/components/ui'
import { getCurrentUser } from '@/lib/auth'
import { getExperimentResults } from '@/lib/experiments'
import { getPreviewVariant, getVariant, getVisitorId, isEnabled } from '@/lib/flags'
import { getPayloadClient } from '@/lib/payload'

import { ShowcaseSection } from '../ShowcaseSection'

const FLAGS = ['home-hero', 'gift-cards', 'new-booking-flow'] as const

const percent = (rate: number | null) => (rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`)

/** Showcase for @xtr-dev/payload-feature-flags: your assignments, the flags and the A/B results. */
export const FeatureFlagsShowcase = async () => {
  const [payload, user, visitorId] = await Promise.all([
    getPayloadClient(),
    getCurrentUser(),
    getVisitorId(),
  ])
  const [heroVariant, heroPreview, giftCards, newBookingFlow, results, flags] = await Promise.all([
    getVariant('home-hero', { userId: user?.id }),
    getPreviewVariant('home-hero'),
    isEnabled('gift-cards'),
    isEnabled('new-booking-flow', { userId: user?.id }),
    getExperimentResults(payload, 'home-hero'),
    Promise.all(FLAGS.map((name) => getFeatureFlag(name, payload))),
  ])
  const heroSubject = visitorId ?? user?.id
  const rolloutSubject = user?.id ?? visitorId

  return (
    <ShowcaseSection
      id="feature-flags"
      pkg="@xtr-dev/payload-feature-flags"
      title="Experiments and rollouts"
      intro="Flags decide which homepage hero you see, whether gift cards are on sale, and who gets the new booking flow."
      features={[
        'A/B test on the homepage hero: weighted variants, sticky per visitor cookie, with exposures and conversions recorded',
        'Gift cards gated behind an on/off flag: the nav link and the page disappear together',
        'Percentage rollout of the new booking flow, bucketed per member',
        'Server components use the RSC helpers (with the opt-in cross-request cache); the panel below also asks the client hooks',
        'Visitors never read the flags collection: the hooks use the public evaluate endpoint',
        'Admins toggle flags from the plugin’s dashboard in the admin panel',
      ]}
      usedOn={[
        ['Homepage', '/'],
        ['Gift cards', '/gift-cards'],
        ['Booking', '/workshops'],
        ['Admin dashboard', '/admin/feature-flags-overview'],
      ]}
      status="live"
      tone="bisque"
    >
      <div className="space-y-6">
        <FlagDebugPanel
          key={`${visitorId}-${user?.id}`}
          visitorId={visitorId ?? null}
          rolloutSubject={user ? 'member' : 'visitor'}
          server={{ heroVariant, heroPreview: heroPreview !== null, giftCards, newBookingFlow }}
          keys={{
            hero: heroSubject === undefined ? '' : String(heroSubject),
            rollout: rolloutSubject === undefined ? '' : String(rolloutSubject),
          }}
        />

        <Card as="section" aria-labelledby="hero-results-heading" className="p-6">
          <h3 id="hero-results-heading" className="text-2xl text-ink">
            Homepage hero results
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            Real visits to this site. An exposure is a visitor seeing a variant; a conversion is
            that visitor clicking the hero’s booking button. Each visitor counts once.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="hero-results">
              <thead className="text-ink-soft">
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Variant
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Traffic
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Exposures
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Conversions
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.variant} className="border-b border-line/60">
                    <th scope="row" className="py-2 pr-3 font-mono font-semibold text-ink">
                      {r.variant}
                    </th>
                    <td className="py-2 pr-3">{r.weight}%</td>
                    <td className="py-2 pr-3" data-testid={`exposures-${r.variant}`}>
                      {r.exposures}
                    </td>
                    <td className="py-2 pr-3" data-testid={`conversions-${r.variant}`}>
                      {r.conversions}
                    </td>
                    <td className="py-2">{percent(r.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-ink-soft">
            Admins see every event under Experiments → Experiment events.
          </p>
        </Card>

        <Card as="section" aria-labelledby="flag-list-heading" className="p-6">
          <h3 id="flag-list-heading" className="text-2xl text-ink">
            The flags
          </h3>
          <ul className="mt-4 divide-y divide-line/60">
            {FLAGS.map((name, i) => {
              const flag = flags[i]
              return (
                <li key={name} className="py-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <code className="font-mono font-semibold text-ink">{name}</code>
                    <span className="text-sm text-ink-soft">
                      {!flag
                        ? 'missing'
                        : !flag.enabled
                          ? 'off'
                          : flag.variants?.length
                            ? flag.variants.map((v) => `${v.name} ${v.weight}%`).join(' / ')
                            : `on for ${flag.rolloutPercentage ?? 100}%`}
                    </span>
                  </p>
                  {flag?.description && (
                    <p className="mt-1 text-sm text-ink-soft">{flag.description}</p>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-sm text-ink-soft">
            Sign in as <code className="font-mono">admin@kiln.test</code> and open the plugin’s{' '}
            <Link
              href="/admin/feature-flags-overview"
              className="font-semibold text-clay underline-offset-4 hover:underline"
            >
              feature flags dashboard
            </Link>{' '}
            to toggle them, or edit them under{' '}
            <Link
              href="/admin/collections/feature-flags"
              className="font-semibold text-clay underline-offset-4 hover:underline"
            >
              Experiments → Feature Flags
            </Link>
            .
          </p>
        </Card>
      </div>
    </ShowcaseSection>
  )
}
