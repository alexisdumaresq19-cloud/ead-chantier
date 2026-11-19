#!/usr/bin/env bash
# End-to-end tests: builds the app, starts it on its own database and file
# folder, fills it with the fictional sample data, then runs Playwright.
#   scripts/e2e.sh [playwright arguments]      e.g. scripts/e2e.sh --project=phone
#   E2E_SKIP_BUILD=1 scripts/e2e.sh            reuse the last build
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${E2E_PORT:-3300}"
export DATABASE_URL="postgres://ead:ead@127.0.0.1:${EAD_PG_PORT:-54329}/ead_e2e"
export STORAGE_DRIVER=fs
export STORAGE_DIR=.data/e2e-storage
export APP_SECRET=e2e-secret-not-for-production
export SETUP_CODE=dev
export SEED_OUT=.data/e2e
export BASE="http://localhost:$PORT"

scripts/db.sh start >/dev/null
scripts/db.sh fresh
npx tsx scripts/migrate.ts
rm -rf "$STORAGE_DIR" "$SEED_OUT"
[ -n "${E2E_SKIP_BUILD:-}" ] || npx next build >/dev/null

mkdir -p .data
npx next start -p "$PORT" >.data/e2e-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -sf "$BASE/api/setup" >/dev/null && break
  sleep 1
done

npx tsx scripts/seed-dev.mts
npx playwright test --trace off "$@"
