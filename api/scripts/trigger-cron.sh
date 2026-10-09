#!/bin/bash
# Triggers ONE production planting run (GET /api/cron/plant); the secret is read from .env.local, never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
grep -m1 '^CRON_SECRET=' .env.local | cut -d= -f2- | sed 's/^/Authorization: Bearer /' | curl -s -m 300 -H @- -o /tmp/sprouts-cron-out.json -w 'HTTP %{http_code} in %{time_total}s\n' https://sprouts.money/api/cron/plant
