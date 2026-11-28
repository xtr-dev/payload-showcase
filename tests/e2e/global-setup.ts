import { type FullConfig, request } from '@playwright/test'

import { createSeededSessions } from '../helpers/e2e'

/** Runs once, after the web server is up and before any test: see `createSeededSessions`. */
export default async function globalSetup(config: FullConfig) {
  const api = await request.newContext({ baseURL: config.projects[0].use.baseURL })
  try {
    await createSeededSessions(api)
  } finally {
    await api.dispose()
  }
}
