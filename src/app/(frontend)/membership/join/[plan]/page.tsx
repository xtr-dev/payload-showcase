import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { joinMembership } from '@/components/membership/actions'
import { Alert, Button, Card, Container } from '@/components/ui'
import { requireUser } from '@/lib/auth'
import { formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'

export const metadata: Metadata = { title: 'Join', robots: { index: false } }

export default async function JoinPage({ params }: { params: Promise<{ plan: string }> }) {
  const { plan: slug } = await params
  const user = await requireUser(`/membership/join/${slug}`)
  const payload = await getPayloadClient()
  const { docs } = await payload.find({
    collection: 'membership-plans',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: false,
  })
  const plan = docs[0]
  if (!plan) notFound()

  const current = user.membershipStatus === 'active' || user.membershipStatus === 'pending'

  return (
    <Container narrow className="py-14 lg:py-20">
      <Link href="/membership" className="text-sm font-medium text-clay hover:underline">
        ← All plans
      </Link>
      <h1 className="mt-4 text-4xl text-ink sm:text-5xl">Join as {plan.name}</h1>
      <Card className="mt-8 p-6 sm:p-8">
        <p className="font-display text-4xl font-semibold text-clay">
          {formatPrice(plan.price)}{' '}
          <span className="font-sans text-base font-normal text-ink-soft">per month</span>
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-ink-soft">
          {plan.perks?.map((p) => (
            <li key={p.id ?? p.perk}>{p.perk}</li>
          ))}
        </ul>
        {current && (
          <Alert tone="info" className="mt-6">
            You already have a membership ({user.membershipStatus}). Joining again switches your
            plan.
          </Alert>
        )}
        <form action={joinMembership} className="mt-8">
          <input type="hidden" name="plan" value={plan.slug} />
          <Button type="submit" size="lg" className="w-full">
            Continue to payment
          </Button>
        </form>
      </Card>
    </Container>
  )
}
