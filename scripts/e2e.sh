#!/usr/bin/env bash
# End-to-end tests: builds the app, starts it on its own database and file
# folder, fills it with the fictional sample data, then runs Playwright.
#   scripts/e2e.sh [playwright arguments]      e.g. scripts/e2e.sh --project=phone
#   E2E_SKIP_BUILD=1 scripts/e2e.sh            reuse the last build
#   E2E_PORT=3301 E2E_DB=ead_e2e_2 scripts/e2e.sh   beside another run on the same machine
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${E2E_PORT:-3300}"
PG="postgres://ead:ead@127.0.0.1:${EAD_PG_PORT:-54329}"
export DATABASE_URL="$PG/${E2E_DB:-ead_e2e}"
# A production build on the development file store: it has to be asked for.
export STORAGE_DRIVER=fs
export ALLOW_FS_STORAGE=1
# The dictation answers by fixed rules, so no test ever calls a paid service.
export AI_FAKE=1
export STORAGE_DIR=.data/e2e-storage
export APP_SECRET=e2e-secret-not-for-production
# Production ignores a setup code shorter than 16 characters.
export SETUP_CODE=e2e-setup-code-not-for-production
export SEED_OUT=.data/e2e
export BASE="http://localhost:$PORT"

if curl -sf "$BASE/api/setup" >/dev/null; then
  echo "Le port $PORT répond déjà : arrêtez ce serveur ou choisissez un autre E2E_PORT." >&2
  exit 1
fi

# The local Postgres is started only if none answers (another checkout's may be running).
psql "$PG/postgres" -Atqc "select 1" >/dev/null 2>&1 || scripts/db.sh start >/dev/null
scripts/db.sh fresh
npx tsx scripts/migrate.ts
rm -rf "$STORAGE_DIR" "$SEED_OUT"
[ -n "${E2E_SKIP_BUILD:-}" ] || npx next build >/dev/null

mkdir -p .data
node_modules/.bin/next start -p "$PORT" >.data/e2e-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -sf "$BASE/api/setup" >/dev/null && break
  sleep 1
done

npx tsx scripts/seed-dev.mts
npx playwright test --trace off "$@"
