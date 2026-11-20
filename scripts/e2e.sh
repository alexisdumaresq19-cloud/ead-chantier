#!/usr/bin/env bash
# End-to-end tests: builds the app, starts it on its own database and file
# folder, fills it with the fictional sample data, then runs Playwright, once
# per screen size, each on fresh data.
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
# The door of account creation, held as in production, with room for the
# accounts the tests make (e2e/sign-up.spec.ts fills the rest itself).
export SIGNUP_TRIES_PER_HOUR=5
export SIGNUP_WRONG_CODES_PER_DAY=20
export SIGNUP_ACCOUNTS_PER_DAY=40
export BASE="http://localhost:$PORT"

if curl -sf "$BASE/api/setup" >/dev/null; then
  echo "Le port $PORT répond déjà : arrêtez ce serveur ou choisissez un autre E2E_PORT." >&2
  exit 1
fi

# The local Postgres is started only if none answers (another checkout's may be running).
psql "$PG/postgres" -Atqc "select 1" >/dev/null 2>&1 || scripts/db.sh start >/dev/null
[ -n "${E2E_SKIP_BUILD:-}" ] || npx next build >/dev/null
mkdir -p .data

SERVER=""
stop_server() {
  [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null || true
  [ -n "$SERVER" ] && wait "$SERVER" 2>/dev/null || true
  SERVER=""
}
trap stop_server EXIT

# An empty database and file folder, the server on them, and the sample data.
start_fresh() {
  stop_server
  scripts/db.sh fresh
  npx tsx scripts/migrate.ts
  rm -rf "$STORAGE_DIR" "$SEED_OUT"
  node_modules/.bin/next start -p "$PORT" >.data/e2e-server.log 2>&1 &
  SERVER=$!
  for _ in $(seq 1 60); do
    curl -sf "$BASE/api/setup" >/dev/null && break
    sleep 1
  done
  npx tsx scripts/seed-dev.mts
}

# Tests change the sample data (they import plans, archive a sheet, write
# reports). Each size therefore starts from the same fresh data, unless the
# caller chose what to run.
for argument in "$@"; do
  case "$argument" in
    --project | --project=*)
      start_fresh
      npx playwright test --trace off "$@"
      exit $?
      ;;
  esac
done

STATUS=0
for project in phone desktop; do
  start_fresh
  npx playwright test --trace off --project="$project" "$@" || STATUS=$?
done
exit $STATUS
