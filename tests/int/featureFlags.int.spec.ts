import { randomUUID } from 'crypto'
import type { Endpoint, Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  assignVariant,
  EVENTS_SLUG,
  evaluateFlag,
  FLAGS_SLUG,
  getExperimentResults,
  previewCookie,
  VISITOR_COOKIE,
} from '@/lib/experiments'
import { seed } from '@/seed'

import { getTestPayload, type TestPayload } from '../helpers/payload'

let t: TestPayload
let payload: Payload

beforeAll(async () => {
  t = await getTestPayload()
  payload = t.payload
  await seed(payload)
})

afterAll(async () => {
  await t?.cleanup()
})

const flagId = async (name: string) =>
  (await payload.find({ collection: FLAGS_SLUG, where: { name: { equals: name } }, limit: 1 }))
    .docs[0].id

const setFlag = async (
  name: string,
  data: { enabled?: boolean; rolloutPercentage?: number | null },
) => payload.update({ collection: FLAGS_SLUG, id: await flagId(name), data })

const endpoint = (slug: string, path: string): Endpoint => {
  const collection = payload.config.collections.find((c) => c.slug === slug)
  const found = (collection?.endpoints || []).find((e) => e.path === path)
  if (!found) throw new Error(`No ${path} endpoint on ${slug}`)
  return found
}

const ids = (n: number) => Array.from({ length: n }, () => randomUUID())

describe('FeatureFlags (payload-feature-flags)', () => {
  it('is wired into the Payload config with the seeded flags', async () => {
    const { docs } = await payload.find({ collection: FLAGS_SLUG, sort: 'name' })
    expect(docs.map((d) => d.name)).toEqual(['gift-cards', 'home-hero', 'new-booking-flow', 'shop'])
    expect(payload.config.collections.some((c) => c.slug === EVENTS_SLUG)).toBe(true)
    expect(payload.config.admin.components.views?.['feature-flags-overview']).toBeDefined()
  })

  it('keeps the flags collection closed to visitors', async () => {
    await expect(payload.find({ collection: FLAGS_SLUG, overrideAccess: false })).rejects.toThrow()
  })

  it('evaluates on/off flags and follows changes', async () => {
    expect(await evaluateFlag(payload, 'gift-cards')).toBe(true)
    expect(await evaluateFlag(payload, 'gift-cards', randomUUID())).toBe(true)
    expect(await evaluateFlag(payload, 'no-such-flag')).toBe(false)

    await setFlag('gift-cards', { enabled: false })
    expect(await evaluateFlag(payload, 'gift-cards')).toBe(false)
    expect(await evaluateFlag(payload, 'gift-cards', randomUUID())).toBe(false)
    await setFlag('gift-cards', { enabled: true })
  })

  it('splits hero traffic by the variant weights (60/40) and keeps it sticky', async () => {
    const visitors = ids(2000)
    const variants = await Promise.all(visitors.map((v) => assignVariant(payload, 'home-hero', v)))
    const shareA = variants.filter((v) => v === 'a').length / visitors.length
    expect(shareA).toBeGreaterThan(0.5)
    expect(shareA).toBeLessThan(0.7)
    expect(new Set(variants)).toEqual(new Set(['a', 'b']))

    // Same visitor, same variant.
    for (const [i, v] of visitors.slice(0, 50).entries()) {
      expect(await assignVariant(payload, 'home-hero', v)).toBe(variants[i])
    }
    // No visitor to bucket: the control.
    expect(await assignVariant(payload, 'home-hero')).toBe('a')
  })

  it('rolls the new booking flow out to the configured percentage', async () => {
    const users = ids(1000)
    const inRollout = async () =>
      (await Promise.all(users.map((u) => evaluateFlag(payload, 'new-booking-flow', u)))).filter(
        Boolean,
      ).length / users.length

    const half = await inRollout()
    expect(half).toBeGreaterThan(0.4)
    expect(half).toBeLessThan(0.6)

    await setFlag('new-booking-flow', { rolloutPercentage: 10 })
    const tenth = await inRollout()
    expect(tenth).toBeGreaterThan(0.04)
    expect(tenth).toBeLessThan(0.16)

    await setFlag('new-booking-flow', { rolloutPercentage: 0 })
    expect(await inRollout()).toBe(0)

    await setFlag('new-booking-flow', { rolloutPercentage: 100 })
    expect(await inRollout()).toBe(1)

    await setFlag('new-booking-flow', { rolloutPercentage: 50 })
  })

  it('answers the public evaluate endpoint with the same buckets as the server', async () => {
    const evaluate = endpoint(FLAGS_SLUG, '/evaluate')
    const visitor = randomUUID()
    const res = await evaluate.handler({
      payload,
      url: `http://localhost/api/feature-flags/evaluate?names=home-hero,secret&userId=${visitor}`,
    } as never)
    const { flags } = (await res.json()) as {
      flags: Record<string, { enabled: boolean; variant?: string | null }>
    }
    expect(flags['home-hero'].variant).toBe(await assignVariant(payload, 'home-hero', visitor))
    // Unknown flags look exactly like disabled ones.
    expect(flags.secret).toEqual({
      name: 'secret',
      enabled: false,
      variant: null,
      inRollout: false,
    })
  })

  it('records one exposure and conversion per visitor, and ignores previews', async () => {
    const track = endpoint(EVENTS_SLUG, '/track')
    const send = (visitorId: string, type: string, extraCookie = '') =>
      track.handler({
        payload,
        headers: new Headers({ cookie: `${VISITOR_COOKIE}=${visitorId}${extraCookie}` }),
        json: async () => ({ experiment: 'home-hero', type }),
      } as never)

    const visitor = randomUUID()
    const variant = await assignVariant(payload, 'home-hero', visitor)
    expect(await (await send(visitor, 'exposure')).json()).toEqual({ recorded: true, variant })
    expect(await (await send(visitor, 'exposure')).json()).toMatchObject({ recorded: false })
    expect(await (await send(visitor, 'conversion')).json()).toMatchObject({ recorded: true })

    const previewer = randomUUID()
    const preview = await send(previewer, 'exposure', `; ${previewCookie('home-hero')}=b`)
    expect(await preview.json()).toEqual({ recorded: false })
    expect((await send(visitor, 'bogus')).status).toBe(400)

    const results = await getExperimentResults(payload, 'home-hero')
    const row = results.find((r) => r.variant === variant)!
    expect(row).toMatchObject({ exposures: 1, conversions: 1, rate: 1 })
    expect(results.map((r) => r.weight)).toEqual([60, 40])
  })

  it('hides the gift card route while the flag is off', async () => {
    const { default: GiftCardsPage } = await import('@/app/(frontend)/gift-cards/page')

    await expect(GiftCardsPage()).resolves.toBeTruthy()

    await setFlag('gift-cards', { enabled: false })
    await expect(GiftCardsPage()).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    })
    await setFlag('gift-cards', { enabled: true })
  })
})
