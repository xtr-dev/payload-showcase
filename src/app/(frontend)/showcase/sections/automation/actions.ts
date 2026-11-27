'use server'

import { revalidatePath } from 'next/cache'

import { getCurrentUser } from '@/lib/auth'
import { runStudioDigest, type StudioDigestRun } from '@/lib/automation'
import { getPayloadClient } from '@/lib/payload'

export interface DigestState {
  run?: StudioDigestRun
  error?: string
}

/** Server action behind the admin-only "Run the studio digest" button. */
export const runDigestAction = async (
  _prev: DigestState,
  _form: FormData,
): Promise<DigestState> => {
  const [payload, user] = await Promise.all([getPayloadClient(), getCurrentUser()])
  try {
    const run = await runStudioDigest(payload, user)
    revalidatePath('/showcase')
    revalidatePath('/showcase/automation')
    return { run }
  } catch (error) {
    if (error instanceof Error && error.name === 'Forbidden') {
      return { error: 'Only studio admins can run workflows by hand.' }
    }
    payload.logger.error({ err: error }, 'Manual studio digest failed')
    return { error: 'The digest could not be started. See the server log.' }
  }
}
