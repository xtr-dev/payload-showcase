import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/int/**/*.int.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Each test file boots its own Payload instance on its own temporary SQLite file.
    // The forks pool with isolation gives every file a fresh process, so Payload's
    // module-level singleton cache never leaks between files.
    pool: 'forks',
    isolate: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
