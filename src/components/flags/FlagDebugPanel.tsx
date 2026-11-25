'use client'

import {
  useFeatureFlag,
  useRolloutCheck,
  useVariantSelection,
} from '@xtr-dev/payload-feature-flags/client'
import type { ReactNode } from 'react'

import { Badge, Button, Card } from '@/components/ui'
import type { Variant } from '@/lib/experiments'

import { previewHeroVariant, resetAssignment } from './actions'

export interface FlagDebugPanelProps {
  /** This browser's `kiln_vid` cookie. */
  visitorId: string | null
  /** Whether rollouts bucket on the signed-in member or on the visitor cookie. */
  rolloutSubject: 'member' | 'visitor'
  /** What the server (RSC helpers, through src/lib/flags.ts) decided for this request. */
  server: {
    heroVariant: Variant
    heroPreview: boolean
    giftCards: boolean
    newBookingFlow: boolean
  }
  /** The ids the client hooks bucket on; the same flag-prefixed ids the server uses. */
  keys: { hero: string; rollout: string }
}

const OPTIONS = { source: 'public' } as const

const Value = ({ children, testId }: { children: ReactNode; testId: string }) => (
  <code className="rounded-md bg-ink/5 px-2 py-0.5 font-mono text-sm text-ink" data-testid={testId}>
    {children}
  </code>
)

const onOff = (on: boolean) => (on ? 'on' : 'off')

/**
 * Visitor-facing debug panel: what this browser got from each flag, evaluated twice, once on the
 * server with the RSC helpers and once in the browser with the plugin's client hooks (via the
 * public evaluate endpoint). Both bucket on the same id, so they should agree.
 */
export const FlagDebugPanel = ({
  visitorId,
  rolloutSubject,
  server,
  keys,
}: FlagDebugPanelProps) => {
  const hero = useVariantSelection('home-hero', keys.hero, OPTIONS)
  const giftCards = useFeatureFlag('gift-cards', OPTIONS)
  const rollout = useRolloutCheck('new-booking-flow', keys.rollout, OPTIONS)
  const loading = hero.loading || giftCards.loading || rollout.loading

  const rows: Array<{
    flag: string
    label: string
    server: string
    client: string | null
    note?: string
  }> = [
    {
      flag: 'home-hero',
      label: 'Homepage hero variant',
      server: server.heroVariant,
      client: hero.variant,
      note: server.heroPreview ? 'Previewing. The hook shows your real assignment.' : undefined,
    },
    {
      flag: 'gift-cards',
      label: 'Gift cards',
      server: onOff(server.giftCards),
      client: onOff(giftCards.isEnabled),
    },
    {
      flag: 'new-booking-flow',
      label: `New booking flow (by ${rolloutSubject})`,
      server: server.newBookingFlow ? 'in rollout' : 'not yet',
      client: rollout.isInRollout ? 'in rollout' : 'not yet',
    },
  ]

  return (
    <Card
      as="section"
      aria-labelledby="flag-debug-heading"
      className="p-6"
      data-testid="flag-debug"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="flag-debug-heading" className="text-2xl text-ink">
          Your flags
        </h3>
        <p className="text-sm text-ink-soft">
          Visitor id <Value testId="visitor-id">{visitorId ? visitorId.slice(0, 8) : 'none'}</Value>
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-ink-soft">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Flag
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Server (RSC)
              </th>
              <th scope="col" className="py-2 font-semibold">
                Browser (hook)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const agree = row.client === row.server
              return (
                <tr key={row.flag} className="border-b border-line/60 align-top">
                  <th scope="row" className="py-3 pr-3 font-normal">
                    <span className="block font-semibold text-ink">{row.label}</span>
                    <code className="font-mono text-xs text-ink-soft">{row.flag}</code>
                    {row.note && (
                      <span className="mt-1 block text-xs text-warning">{row.note}</span>
                    )}
                  </th>
                  <td className="py-3 pr-3">
                    <Value testId={`server-${row.flag}`}>{row.server}</Value>
                  </td>
                  <td className="py-3">
                    {loading ? (
                      <span className="text-ink-soft">loading…</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <Value testId={`client-${row.flag}`}>{row.client ?? 'none'}</Value>
                        {!row.note && (
                          <Badge tone={agree ? 'success' : 'warning'}>
                            {agree ? 'matches' : 'differs'}
                          </Badge>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <form action={previewHeroVariant} className="contents">
          <Button type="submit" name="variant" value="a" variant="outline" size="sm">
            Preview hero A
          </Button>
          <Button type="submit" name="variant" value="b" variant="outline" size="sm">
            Preview hero B
          </Button>
        </form>
        <form action={resetAssignment}>
          <Button type="submit" variant="secondary" size="sm">
            Reset my assignment
          </Button>
        </form>
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        Reset gives this browser a new visitor id, so the experiment and the visitor rollouts pick
        again. Previews are not counted in the results.
      </p>
    </Card>
  )
}
