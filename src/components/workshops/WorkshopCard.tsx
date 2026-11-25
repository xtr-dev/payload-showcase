import Link from 'next/link'

import { Badge, MediaImage } from '@/components/ui'
import { asMedia, FORMAT_LABELS, formatDuration, formatPrice, LEVEL_LABELS } from '@/lib/format'
import type { Workshop } from '@/payload-types'

export const WorkshopCard = ({
  workshop,
  headingLevel = 'h3',
}: {
  workshop: Workshop
  headingLevel?: 'h2' | 'h3'
}) => {
  const Heading = headingLevel
  const image = asMedia(workshop.images?.[0])
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card border border-line/70 bg-white/70 shadow-card transition duration-300 ease-out-soft hover:-translate-y-1 hover:shadow-lift">
      <div className="aspect-[4/3] overflow-hidden bg-sand">
        <MediaImage
          media={image}
          className="transition-transform duration-500 ease-out-soft group-hover:scale-[1.04]"
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <div className="flex flex-wrap gap-2">
          <Badge tone={workshop.format === 'course' ? 'glaze' : 'clay'}>
            {FORMAT_LABELS[workshop.format]}
            {workshop.format === 'course' && workshop.weeks ? ` · ${workshop.weeks} weeks` : ''}
          </Badge>
          <Badge>{LEVEL_LABELS[workshop.level]}</Badge>
        </div>
        <Heading className="text-2xl leading-snug text-ink">
          {/* The link covers the whole card; the title stays the accessible name. */}
          <Link
            href={`/workshops/${workshop.slug}`}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-card focus-visible:after:outline-3 focus-visible:after:outline-cobalt"
          >
            {workshop.title}
          </Link>
        </Heading>
        <p className="text-ink-soft">{workshop.summary}</p>
        <div className="mt-auto flex items-end justify-between border-t border-dashed border-line pt-4">
          <p className="text-sm text-ink-soft">{formatDuration(workshop.duration)} per session</p>
          <p className="font-display text-2xl font-semibold text-clay">
            {formatPrice(workshop.price)}
          </p>
        </div>
      </div>
    </article>
  )
}
