#!/usr/bin/env bash
# Starts the production server that the Playwright suite runs against.
#
# 1. Resets and seeds an isolated SQLite database in .e2e/ (schema is pushed by the seed run,
#    which runs in development mode; `next start` then connects to the ready database).
# 2. Builds the app unless E2E_SKIP_BUILD=1 and a build already exists (CI builds in its own step).
# 3. Runs `next start` on E2E_PORT (default 3100).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${E2E_PORT:-3100}"
export DATABASE_URL="file:./.e2e/kiln-e2e.db"
export MEDIA_DIR="./.e2e/media"
export PAYLOAD_SECRET="${PAYLOAD_SECRET:-e2e-secret-not-for-production}"
export SEED_ON_INIT=false

rm -rf .e2e
mkdir -p .e2e
NODE_ENV=development pnpm seed

if [[ "${E2E_SKIP_BUILD:-0}" != "1" || ! -f .next/BUILD_ID ]]; then
  pnpm build
fi

exec pnpm start --port "$PORT"
