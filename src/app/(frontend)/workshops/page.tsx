import type { Metadata } from 'next'
import Link from 'next/link'
import type { Where } from 'payload'

import { Button, Container, SectionHeading, SelectField, TextField } from '@/components/ui'
import { WorkshopCard } from '@/components/workshops/WorkshopCard'
import { WORKSHOP_FORMATS, WORKSHOP_LEVELS } from '@/collections/Workshops'
import { getPayloadClient } from '@/lib/payload'

export const metadata: Metadata = {
  title: 'Workshops',
  description: 'One-off pottery classes and multi-week courses for every level.',
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export default async function WorkshopsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const level = one(params.level)
  const format = one(params.format)
  const q = one(params.q).trim()

  const and: Where[] = []
  if (WORKSHOP_LEVELS.some((l) => l.value === level)) and.push({ level: { equals: level } })
  if (WORKSHOP_FORMATS.some((f) => f.value === format)) and.push({ format: { equals: format } })
  if (q) and.push({ or: [{ title: { like: q } }, { summary: { like: q } }] })

  const payload = await getPayloadClient()
  // overrideAccess: false applies the public read rule, so drafts never appear here.
  const { docs: workshops } = await payload.find({
    collection: 'workshops',
    where: and.length ? { and } : undefined,
    sort: 'price',
    depth: 1,
    limit: 50,
    overrideAccess: false,
  })
  const filtered = Boolean(level || format || q)

  return (
    <>
      <section className="grain border-b border-line bg-bisque">
        <Container className="py-14 lg:py-20">
          <SectionHeading
            as="h1"
            eyebrow="Workshops & courses"
            title={
              <>
                Find your <span className="squiggle">place at the wheel</span>
              </>
            }
            intro="Evening classes for first-timers, hand-building for families and longer courses for when you are properly hooked."
          />
        </Container>
      </section>

      <Container className="py-12 lg:py-16">
        {/* Keyed on the active filters: uncontrolled fields only read defaultValue on mount, so the
            form must remount when "Clear" or back/forward navigation changes the query. */}
        <form
          key={`${q}|${level}|${format}`}
          role="search"
          aria-label="Filter workshops"
          method="get"
          className="grid gap-4 rounded-card border border-line bg-white/60 p-5 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end"
        >
          <TextField
            id="q"
            label="Search"
            type="search"
            placeholder="Glaze, mugs, wheel…"
            defaultValue={q}
          />
          <SelectField id="level" label="Level" defaultValue={level}>
            <option value="">Any level</option>
            {WORKSHOP_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </SelectField>
          <SelectField id="format" label="Format" defaultValue={format}>
            <option value="">Any format</option>
            {WORKSHOP_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </SelectField>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1 lg:flex-none">
              Filter
            </Button>
            {filtered && (
              <Link
                href="/workshops"
                className="inline-flex h-11 items-center rounded-pill px-4 font-semibold text-clay hover:underline"
              >
                Clear
              </Link>
            )}
          </div>
        </form>

        <p className="mt-8 text-ink-soft" aria-live="polite" data-testid="result-count">
          {workshops.length === 1 ? '1 workshop' : `${workshops.length} workshops`}
          {filtered ? ' match your filters' : ''}
        </p>

        {workshops.length > 0 ? (
          <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {workshops.map((w) => (
              <WorkshopCard key={w.id} workshop={w} headingLevel="h2" />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-card border border-dashed border-line p-10 text-center">
            <p className="font-display text-2xl text-ink">Nothing on the wheel for that yet.</p>
            <p className="mt-2 text-ink-soft">Try a different level or format.</p>
          </div>
        )}
      </Container>
    </>
  )
}
