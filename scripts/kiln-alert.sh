#!/usr/bin/env bash
# Posts a kiln temperature reading to the "Kiln temperature alert" workflow's webhook, the way the
# studio's kiln controller would. Readings at or above 1250 °C page the kiln technician and write
# a studio log entry; lower ones are skipped by the trigger condition.
#
# Usage: bash scripts/kiln-alert.sh [temperatureC] [base URL]
# The secret is AUTOMATION_WEBHOOK_SECRET (read from .env when it is set there), or the public
# development default from src/seed/automation.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${AUTOMATION_WEBHOOK_SECRET:-}" && -f .env ]]; then
  AUTOMATION_WEBHOOK_SECRET="$(sed -n 's/^AUTOMATION_WEBHOOK_SECRET=//p' .env | tail -n 1)"
fi
SECRET="${AUTOMATION_WEBHOOK_SECRET:-kiln-dev-webhook-secret-change-me}"
TEMPERATURE="${1:-1290}"
BASE_URL="${2:-http://localhost:3000}"

curl --fail-with-body -sS -X POST "$BASE_URL/api/automation/webhooks/kiln-alert" \
  -H "X-Webhook-Secret: $SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"kiln\": \"Big Bertha\", \"temperatureC\": $TEMPERATURE}"
echo
