import type { Metadata } from 'next'

import { Sprig } from '@/components/art/Decor'
import { ButtonLink, Container, SectionHeading, cn } from '@/components/ui'
import { formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'

export const metadata: Metadata = {
  title: 'Membership',
  description: 'Open-studio membership with clay, firings and workshop discounts included.',
}

const FAQ = [
  {
    q: 'Do I need experience to become a member?',
    a: 'We ask that members have taken a course or a few classes, so you can work safely on your own. Not sure? Book a beginner class first.',
  },
  {
    q: 'Can I pause or cancel?',
    a: 'Yes. Memberships run month to month and you can pause for up to two months a year.',
  },
  {
    q: 'What does “clay and firings included” mean?',
    a: 'Each month you can use up to 10 kg of our house stoneware, and we bisque and glaze-fire everything made with it.',
  },
]

export default async function MembershipPage() {
  const payload = await getPayloadClient()
  const { docs: plans } = await payload.find({
    collection: 'membership-plans',
    sort: 'price',
    limit: 10,
    overrideAccess: false,
  })

  return (
    <>
      <section className="grain border-b border-line bg-bisque">
        <Container className="py-14 text-center lg:py-20">
          <SectionHeading
            as="h1"
            align="center"
            eyebrow="Studio membership"
            title={
              <>
                A wheel, a shelf and <span className="squiggle">time to play</span>
              </>
            }
            intro="Membership is for makers who want regular studio time. Use the wheels, the glaze kitchen and the kilns, and become part of a friendly bunch of potters."
          />
        </Container>
      </section>

      <Container className="py-14 lg:py-20">
        <ul className="grid gap-8 lg:grid-cols-3 lg:items-stretch">
          {plans.map((plan) => (
            <li
              key={plan.id}
              className={cn(
                'relative flex flex-col rounded-card border p-8',
                plan.highlighted
                  ? 'border-glaze bg-glaze text-white shadow-lift lg:-my-4 lg:py-12'
                  : 'border-line bg-white/70 text-ink shadow-card',
              )}
            >
              {plan.highlighted && (
                <p className="absolute -top-3.5 left-8 rounded-pill bg-ochre px-3 py-1 text-xs font-bold tracking-wide text-ink uppercase">
                  Most popular
                </p>
              )}
              <h2 className="text-2xl">{plan.name}</h2>
              {plan.tagline && (
                <p className={cn('mt-1', plan.highlighted ? 'text-white/85' : 'text-ink-soft')}>
                  {plan.tagline}
                </p>
              )}
              <p className="mt-6 font-display text-5xl font-semibold">
                {formatPrice(plan.price)}
                <span
                  className={cn(
                    'ml-1 font-sans text-base font-normal',
                    plan.highlighted ? 'text-white/80' : 'text-ink-soft',
                  )}
                >
                  / month
                </span>
              </p>
              <ul className="mt-6 flex-1 space-y-3">
                {plan.perks?.map((p) => (
                  <li key={p.id ?? p.perk} className="flex gap-3">
                    <Sprig
                      className={cn(
                        'mt-0.5 h-5 w-5 shrink-0',
                        plan.highlighted ? 'text-ochre' : 'text-glaze',
                      )}
                    />
                    <span>{p.perk}</span>
                  </li>
                ))}
              </ul>
              <ButtonLink
                href={`/membership/join/${plan.slug}`}
                variant={plan.highlighted ? 'light' : 'primary'}
                size="lg"
                className="mt-8"
              >
                Join {plan.name}
              </ButtonLink>
            </li>
          ))}
        </ul>

        <section aria-labelledby="faq-heading" className="mx-auto mt-24 max-w-3xl">
          <h2 id="faq-heading" className="text-3xl text-ink">
            Good to know
          </h2>
          <div className="mt-6 divide-y divide-line border-y border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-xl text-ink [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden
                    className="text-2xl text-clay transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-ink-soft">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </Container>
    </>
  )
}
