import type { Media } from '@/payload-types'

import { cn } from './cn'

/**
 * Renders an uploaded media document. Uses a plain <img> because the seed art is SVG, which
 * next/image does not optimise; real photos uploaded later still render correctly.
 */
export const MediaImage = ({
  media,
  className,
  sizes,
  priority,
}: {
  media: Media | null | undefined
  className?: string
  sizes?: string
  priority?: boolean
}) => {
  if (!media?.url) return <div aria-hidden className={cn('bg-sand', className)} />
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={media.url}
      alt={media.alt ?? ''}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      sizes={sizes}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      className={cn('h-full w-full object-cover', className)}
    />
  )
}
