import type { Metadata } from 'next'
import Link from 'next/link'

import { isAdminUser } from '@/access'
import { Card, Container, SectionHeading } from '@/components/ui'
import { getCurrentUser } from '@/lib/auth'
import { getRecentRuns } from '@/lib/automation'
import { getPayloadClient } from '@/lib/payload'

import { RunList } from '../sections/automation/RunList'

export const metadata: Metadata = {
  title: 'Workflow run history',
  description: 'The latest runs of the Kiln & Co. automation workflows, step by step.',
}

/**
 * Public run history for @xtr-dev/payload-automation. Shows which workflow ran, when, and how
 * each step ended; trigger data, step inputs and outputs stay in the admin panel. Admins also see
 * error messages and a link to each run in the admin.
 */
export default async function AutomationRunsPage() {
  const [payload, user] = await Promise.all([getPayloadClient(), getCurrentUser()])
  const isAdmin = isAdminUser(user)
  const runs = await getRecentRuns(payload, { limit: 25, includeErrors: isAdmin })

  return (
    <Container narrow className="py-16 lg:py-20">
      <Link
        href="/showcase#automation"
        className="text-sm font-semibold text-clay underline-offset-4 hover:underline"
      >
        ← Back to the showcase
      </Link>
      <SectionHeading
        as="h1"
        className="mt-6"
        eyebrow="@xtr-dev/payload-automation"
        title="Workflow run history"
        intro={
          <p>
            The 25 most recent workflow runs, newest first. The full records, with trigger data and
            every step’s input and output, are in{' '}
            {isAdmin ? (
              <Link
                href="/admin/collections/workflow-runs"
                className="font-semibold text-clay underline-offset-4 hover:underline"
              >
                Workflow runs
              </Link>
            ) : (
              'the admin panel'
            )}
            .
          </p>
        }
      />
      <Card as="section" className="mt-10 p-6" aria-label="Runs">
        <RunList runs={runs} adminLinks={isAdmin} />
      </Card>
    </Container>
  )
}
