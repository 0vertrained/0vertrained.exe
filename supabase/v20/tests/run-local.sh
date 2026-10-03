#!/usr/bin/env bash
# supabase/v20/tests/run-local.sh
#
# Proves the v20 schema on a throwaway PostgreSQL cluster with no Docker and
# no Supabase CLI:
#   1. initdb + start a cluster on a private port and socket dir
#   2. apply tests/_local_stub.sql   (auth schema, auth.uid(), API roles)
#   3. apply every migrations/*.sql in order, each TWICE (the second run proves idempotency)
#   4. run tests/*.sql through pg_prove (pgTAP)
#   5. stop the cluster and delete its data directory, always
#
# Requirements: PostgreSQL 15–17 server binaries, the pgTAP extension for
# that major version (Debian/Ubuntu: `apt-get install postgresql-16-pgtap`,
# which also brings pg_prove), and permission to run the server (as the
# `postgres` OS user when invoked by root, otherwise as yourself).
#
# Environment overrides:
#   PG_BIN     directory holding initdb/pg_ctl/psql   (default: autodetect 17→15)
#   PG_PORT    TCP port for the throwaway cluster       (default: 5433)
#   PG_WORK    work directory: data/, sock/, server.log  (default: a mktemp dir)
#   KEEP=1     leave the cluster running for inspection (prints how to stop it)

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"

detect_pg_bin() {
  local v
  for v in 17 16 15; do
    if [ -x "/usr/lib/postgresql/$v/bin/initdb" ]; then
      echo "/usr/lib/postgresql/$v/bin"; return
    fi
  done
  if command -v initdb >/dev/null 2>&1; then
    dirname "$(command -v initdb)"; return
  fi
  echo "run-local.sh: no PostgreSQL server binaries found (set PG_BIN)" >&2
  exit 1
}

PG_BIN="${PG_BIN:-$(detect_pg_bin)}"
PG_PORT="${PG_PORT:-5433}"
PG_WORK="${PG_WORK:-$(mktemp -d /tmp/ovt-v20-pg.XXXXXX)}"
# initdb needs an empty directory, so the socket and log sit beside it.
PG_DATA="$PG_WORK/data"
SOCK_DIR="$PG_WORK/sock"
LOG="$PG_WORK/server.log"

# The server refuses to run as root; hand off to the postgres OS user then.
run_as_pg() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

if ! command -v pg_prove >/dev/null 2>&1; then
  echo "run-local.sh: pg_prove not found. Install pgTAP for your PostgreSQL major version" >&2
  echo "  Debian/Ubuntu: apt-get install postgresql-16-pgtap   (replace 16 with your version)" >&2
  exit 1
fi

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    echo
    echo "KEEP=1: cluster left running on port $PG_PORT (socket $SOCK_DIR)."
    echo "  psql -h $SOCK_DIR -p $PG_PORT -U postgres"
    echo "  stop: $PG_BIN/pg_ctl -D $PG_DATA stop && rm -rf $PG_WORK"
    return
  fi
  run_as_pg "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$PG_WORK"
}
trap cleanup EXIT

mkdir -p "$PG_DATA" "$SOCK_DIR"
if [ "$(id -u)" = "0" ]; then chown -R postgres:postgres "$PG_WORK"; fi

echo "== initdb ($PG_BIN) into $PG_DATA"
run_as_pg "$PG_BIN/initdb" -D "$PG_DATA" -A trust -U postgres >/dev/null
echo "== start on port $PG_PORT"
run_as_pg "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$LOG" -o "-p $PG_PORT -k $SOCK_DIR -c listen_addresses=''" -w start >/dev/null

psql_args=(-h "$SOCK_DIR" -p "$PG_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

echo "== stub: auth schema, auth.uid(), API roles"
psql "${psql_args[@]}" -f "$here/_local_stub.sql" 2>&1 | grep -v -E '^\s*$|1\.\.0' || true
psql "${psql_args[@]}" -c "create extension if not exists pgtap with schema extensions;" 2>&1 | grep -v -E '^\s*$' || true

# Every migration in order, as `supabase db push` would apply them; each one
# twice, because the second run proves it is idempotent.
for migration in "$root"/migrations/*.sql; do
  name="$(basename "$migration")"
  echo "== migration $name (run 1)"
  psql "${psql_args[@]}" -f "$migration" >/dev/null
  echo "== migration $name (run 2: idempotency)"
  psql "${psql_args[@]}" -f "$migration" >/dev/null
done

echo "== pgTAP tests"
cd "$root"
# _local_stub.sql announces itself as a skipped TAP file, so the glob is safe.
pg_prove -h "$SOCK_DIR" -p "$PG_PORT" -U postgres -d postgres "$@" tests/*.sql
