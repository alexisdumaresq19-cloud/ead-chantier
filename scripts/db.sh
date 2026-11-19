#!/usr/bin/env bash
# A local Postgres for development, kept in .data/pg (not committed).
#   scripts/db.sh start | stop | reset
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$PGBIN" ] && PATH="$PGBIN:$PATH"
DIR=".data/pg"
PORT="${EAD_PG_PORT:-54329}"

# Postgres refuses to run as root: in a container, use the postgres account.
run() {
  if [ "$(id -u)" = "0" ]; then
    chown -R postgres "$(dirname "$DIR")" 2>/dev/null || true
    su postgres -c "PATH=$PATH $*"
  else
    "$@"
  fi
}

start() {
  mkdir -p "$(dirname "$DIR")"
  if [ ! -f "$DIR/PG_VERSION" ]; then
    [ "$(id -u)" = "0" ] && chown postgres "$(dirname "$DIR")"
    run initdb -D "$(pwd)/$DIR" -U ead --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    FRESH=1
  fi
  if ! run pg_ctl -D "$(pwd)/$DIR" status >/dev/null 2>&1; then
    run pg_ctl -D "$(pwd)/$DIR" -o "'-p $PORT -k /tmp -c listen_addresses=127.0.0.1'" -l "$(pwd)/$DIR/log.txt" -w start >/dev/null
  fi
  if [ "${FRESH:-0}" = "1" ]; then
    psql -h 127.0.0.1 -p "$PORT" -U ead -d postgres -qc "CREATE DATABASE ead" >/dev/null
  fi
  echo "Postgres: postgres://ead:ead@127.0.0.1:$PORT/ead"
}

stop() { run pg_ctl -D "$(pwd)/$DIR" -m fast stop >/dev/null 2>&1 || true; }

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  reset) stop; rm -rf "$DIR"; start ;;
  *) echo "usage: scripts/db.sh start|stop|reset" >&2; exit 1 ;;
esac
