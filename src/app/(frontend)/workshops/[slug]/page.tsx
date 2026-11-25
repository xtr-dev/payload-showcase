import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { Badge, Container, MediaImage } from '@/components/ui'
import { SessionList } from '@/components/workshops/SessionList'
import { asMedia, FORMAT_LABELS, formatDuration, formatPrice, LEVEL_LABELS } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'

type Params = Promise<{ slug: string }>

const getWorkshop = cache(async (slug: string) => {
  const payload = await getPayloadClient()
  const { docs } = await payload.find({
    collection: 'workshops',
    where: { slug: { equals: slug } },
    depth: 1,
    limit: 1,
    overrideAccess: false,
  })
  return docs[0] ?? null
})

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const workshop = await getWorkshop((await params).slug)
  return workshop ? { title: workshop.title, description: workshop.summary } : {}
}

export default async function WorkshopPage({ params }: { params: Params }) {
  const workshop = await getWorkshop((await params).slug)
  if (!workshop) notFound()

  const payload = await getPayloadClient()
  const { docs: sessions } = await payload.find({
    collection: 'sessions',
    where: {
      and: [
        { workshop: { equals: workshop.id } },
        { status: { equals: 'scheduled' } },
        { startsAt: { greater_than: new Date().toISOString() } },
      ],
    },
    sort: 'startsAt',
    depth: 0,
    limit: 20,
    overrideAccess: false,
  })
  const image = asMedia(workshop.images?.[0])

  const facts = [
    ['Price', `${formatPrice(workshop.price)} per seat`],
    ['Session length', formatDuration(workshop.duration)],
    ...(workshop.format === 'course' && workshop.weeks
      ? [['Course length', `${workshop.weeks} weeks`]]
      : []),
    ['Group size', `Up to ${workshop.capacity}`],
    ...(workshop.instructor ? [['Taught by', workshop.instructor]] : []),
  ]

  return (
    <article>
      <div className="grain border-b border-line bg-bisque">
        <Container className="grid items-center gap-10 py-10 lg:grid-cols-[1.1fr_1fr] lg:py-16">
          <div>
            <nav aria-label="Breadcrumb" className="mb-6 text-sm">
              <ol className="flex flex-wrap gap-2 text-ink-soft">
                <li>
                  <Link href="/workshops" className="font-medium text-clay hover:underline">
                    Workshops
                  </Link>
                </li>
                <li aria-hidden>/</li>
                <li aria-current="page" className="font-medium text-ink">
                  {workshop.title}
                </li>
              </ol>
            </nav>
            <div className="flex flex-wrap gap-2">
              <Badge tone={workshop.format === 'course' ? 'glaze' : 'clay'}>
                {FORMAT_LABELS[workshop.format]}
              </Badge>
              <Badge>{LEVEL_LABELS[workshop.level]}</Badge>
            </div>
            <h1 className="mt-4 text-4xl leading-[1.05] text-ink sm:text-5xl lg:text-6xl">
              {workshop.title}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              {workshop.summary}
            </p>
          </div>
          <div className="arch aspect-[4/3] border-[6px] border-white shadow-lift lg:aspect-[5/4]">
            <MediaImage media={image} priority />
          </div>
        </Container>
      </div>

      <Container className="grid gap-12 py-12 lg:grid-cols-[1.4fr_1fr] lg:py-16">
        <div>
          <h2 className="sr-only">About this workshop</h2>
          {workshop.description ? (
            <RichText data={workshop.description} className="prose-kiln" />
          ) : null}
        </div>

        <aside
          aria-labelledby="dates-heading"
          className="space-y-8 lg:sticky lg:top-8 lg:self-start"
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-card bg-white/70 p-6 shadow-card">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-semibold tracking-[0.12em] text-ink-soft uppercase">
                  {label}
                </dt>
                <dd className="mt-1 font-display text-lg text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h2 id="dates-heading" className="mb-4 text-2xl text-ink">
              Upcoming dates
            </h2>
            <SessionList sessions={sessions} />
          </div>
        </aside>
      </Container>
    </article>
  )
}
