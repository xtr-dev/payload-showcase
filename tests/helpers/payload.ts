import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { getPayload, type Payload } from 'payload'

export interface TestPayload {
  payload: Payload
  /** Shuts Payload down and deletes the temporary database and media folder. */
  cleanup: () => Promise<void>
}

/**
 * Boots Payload through the Local API against a fresh SQLite file in a temporary directory.
 *
 * The config reads DATABASE_URL and MEDIA_DIR when it is imported, so they are set before the
 * dynamic import. Vitest runs each test file in its own process (see vitest.config.mts), so every
 * file gets its own database and Payload instance. The schema is pushed automatically because
 * NODE_ENV is `test`.
 */
export const getTestPayload = async (): Promise<TestPayload> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiln-int-'))
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`
  process.env.MEDIA_DIR = path.join(dir, 'media')

  const { default: config } = await import('@/payload.config')
  const payload = await getPayload({ config })

  return {
    payload,
    cleanup: async () => {
      await payload.destroy()
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}
