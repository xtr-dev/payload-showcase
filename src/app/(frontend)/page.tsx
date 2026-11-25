import { RichText } from '@payloadcms/richtext-lexical/react'

import { Spiral, Sprig } from '@/components/art/Decor'
import { HeroExperimentTracker } from '@/components/flags/HeroExperimentTracker'
import { ButtonLink, Container, MediaImage, SectionHeading } from '@/components/ui'
import { WorkshopCard } from '@/components/workshops/WorkshopCard'
import { getCurrentUser } from '@/lib/auth'
import { getVariant } from '@/lib/flags'
import { asMedia } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import type { Workshop } from '@/payload-types'

const FACTS = [
  { title: 'Eight seats, max', body: 'Every class is small enough for real one-to-one help.' },
  { title: 'Fired in-house', body: 'We glaze and fire your pieces in our own kilns.' },
  { title: 'Two streets from the sea', body: 'Bring sandy shoes. We have tea.' },
]

export default async function HomePage() {
  const [payload, user] = await Promise.all([getPayloadClient(), getCurrentUser()])
  const [home, variant] = await Promise.all([
    // Depth 2 populates the featured workshops and, inside them, their images.
    payload.findGlobal({ slug: 'home', depth: 2 }),
    getVariant('home-hero', { userId: user?.id }),
  ])

  // Variant B copy comes from the "Hero (variant B)" tab; the image is shared by both variants.
  const hero = variant === 'b' && home.heroVariantB?.heading ? home.heroVariantB : home.hero
  const heroImage = asMedia(home.hero?.image)
  const featured = (home.featuredWorkshops ?? []).filter(
    (w): w is Workshop => typeof w === 'object' && w !== null && w._status === 'published',
  )
  const aboutImage = asMedia(home.about?.image)

  return (
    <>
      {/* Hero */}
      <section className="grain overflow-hidden" data-hero-variant={variant}>
        <HeroExperimentTracker experiment="home-hero" ctaHref={hero?.ctaHref} />
        <Container className="grid items-center gap-12 py-14 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div className="relative">
            {hero?.eyebrow && (
              <p className="mb-5 inline-flex items-center gap-2 text-sm font-semibold tracking-[0.14em] text-clay uppercase">
                <Sprig className="h-5 w-5 text-glaze" />
                {hero.eyebrow}
              </p>
            )}
            <h1 className="text-5xl leading-[1.02] text-ink sm:text-6xl lg:text-7xl">
              {hero?.heading}
            </h1>
            {hero?.subheading && (
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft sm:text-xl">
                {hero.subheading}
              </p>
            )}
            <div className="mt-9 flex flex-wrap gap-3">
              {hero?.ctaHref && hero.ctaLabel && (
                <ButtonLink href={hero.ctaHref} size="lg">
                  {hero.ctaLabel}
                </ButtonLink>
              )}
              <ButtonLink href="/membership" size="lg" variant="outline">
                Studio membership
              </ButtonLink>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <Spiral className="absolute -top-8 -left-6 h-24 w-24 text-ochre" />
            <div className="arch aspect-[4/5] border-[6px] border-white shadow-lift">
              <MediaImage media={heroImage} priority />
            </div>
            <p className="absolute -right-2 bottom-10 rotate-3 rounded-2xl bg-glaze px-5 py-3 font-display text-lg text-white shadow-card sm:-right-6">
              Classes from <span className="font-semibold">€55</span>
            </p>
          </div>
        </Container>
      </section>

      {/* Facts strip */}
      <section aria-label="Why Kiln & Co." className="border-y border-line bg-bisque">
        <Container>
          <ul className="grid divide-line py-2 sm:grid-cols-3 sm:divide-x">
            {FACTS.map((f) => (
              <li key={f.title} className="px-2 py-5 sm:px-6">
                <p className="font-display text-xl text-ink">{f.title}</p>
                <p className="mt-1 text-ink-soft">{f.body}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* Featured workshops */}
      {featured.length > 0 && (
        <section aria-labelledby="featured-heading" className="py-20 lg:py-28">
          <Container>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading
                id="featured-heading"
                eyebrow="Workshops"
                title={home.featuredHeading || 'Featured workshops'}
                intro="Pick an evening, a weekend morning or a six-week course. All materials included."
              />
              <ButtonLink href="/workshops" variant="ghost">
                All workshops →
              </ButtonLink>
            </div>
            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((w) => (
                <WorkshopCard key={w.id} workshop={w} />
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* About */}
      {home.about?.heading && (
        <section aria-labelledby="about-heading" className="bg-bisque py-20 lg:py-28">
          <Container className="grid items-center gap-12 lg:grid-cols-2">
            <div className="order-2 lg:order-1">
              <SectionHeading id="about-heading" eyebrow="The studio" title={home.about.heading} />
              {home.about.body && <RichText data={home.about.body} className="prose-kiln mt-6" />}
              <ButtonLink href="/membership" variant="secondary" className="mt-8">
                Become a member
              </ButtonLink>
            </div>
            <div className="order-1 overflow-hidden rounded-card border-[6px] border-white shadow-lift lg:order-2 lg:rotate-1">
              <MediaImage media={aboutImage} className="aspect-[4/3]" />
            </div>
          </Container>
        </section>
      )}

      {/* Testimonials */}
      {home.testimonials && home.testimonials.length > 0 && (
        <section aria-labelledby="testimonials-heading" className="py-20 lg:py-28">
          <Container>
            <SectionHeading
              id="testimonials-heading"
              eyebrow="Kind words"
              title={
                <>
                  Made by <span className="squiggle">our students</span>
                </>
              }
              align="center"
            />
            <ul className="mt-14 grid gap-6 md:grid-cols-3">
              {home.testimonials.map((t, i) => (
                <li key={t.id ?? i}>
                  <figure
                    className={`flex h-full flex-col rounded-card p-7 ${
                      i === 1
                        ? 'bg-glaze text-white md:-translate-y-4'
                        : 'bg-white/70 text-ink shadow-card'
                    }`}
                  >
                    <span aria-hidden className="font-display text-6xl leading-none opacity-40">
                      “
                    </span>
                    <blockquote className="-mt-4 flex-1 text-lg leading-relaxed">
                      <p>{t.quote}</p>
                    </blockquote>
                    <figcaption className="mt-6 text-sm">
                      <span className="font-semibold">{t.name}</span>
                      {t.detail && <span className="opacity-80"> · {t.detail}</span>}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}

      {/* Membership band */}
      <section aria-labelledby="join-heading">
        <Container>
          <div className="grain relative overflow-hidden rounded-[2rem] bg-clay px-8 py-14 text-white sm:px-14">
            <Spiral className="absolute -right-6 -bottom-10 h-56 w-56 text-white/15" />
            <h2 id="join-heading" className="max-w-xl text-3xl sm:text-4xl">
              Make the studio yours.
            </h2>
            <p className="mt-4 max-w-xl text-lg text-white/90">
              Members get open-studio hours, clay and firings included, and first pick of every new
              course.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/membership" variant="light" size="lg">
                See membership plans
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  )
}
