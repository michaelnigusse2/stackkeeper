#!/usr/bin/env bash
# Apply pending SQL migrations in order, once each, inside a transaction.
#
# Usage:
#   DATABASE_URL=postgres://user@host/db ./scripts/migrate.sh
#   ./scripts/migrate.sh --status     # list applied and pending migrations
#
# Deliberately built on psql alone: the schema can be migrated from any machine
# with the Postgres client installed, with no Node.js and no node_modules. The
# same files are applied by the container entrypoint in production.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$HERE/../migrations}"
DATABASE_URL="${DATABASE_URL:-}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL is not set." >&2
  exit 2
fi

psql_run() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --no-psqlrc --quiet "$@"
}

psql_run -c "
  create table if not exists public.schema_migrations (
    version     text primary key,
    checksum    text not null,
    applied_at  timestamptz not null default now()
  );
" >/dev/null

applied_versions="$(psql_run -tA -c "select version from public.schema_migrations order by version;")"

is_applied() {
  grep -Fxq "$1" <<<"$applied_versions"
}

if [[ "${1:-}" == "--status" ]]; then
  for file in "$MIGRATIONS_DIR"/*.sql; do
    version="$(basename "$file" .sql)"
    if is_applied "$version"; then
      echo "applied  $version"
    else
      echo "pending  $version"
    fi
  done
  exit 0
fi

pending=0
for file in "$MIGRATIONS_DIR"/*.sql; do
  version="$(basename "$file" .sql)"
  checksum="$(sha256sum "$file" | cut -d' ' -f1)"

  if is_applied "$version"; then
    recorded="$(psql_run -tA -c "select checksum from public.schema_migrations where version = '$version';")"
    if [[ "$recorded" != "$checksum" ]]; then
      echo "ERROR: $version was applied but its file has changed since." >&2
      echo "       Migrations are immutable. Add a new migration instead." >&2
      exit 1
    fi
    continue
  fi

  echo "applying $version"
  # The file and the bookkeeping row commit together, so a failure leaves no
  # half-applied migration behind.
  psql_run --single-transaction \
    -f "$file" \
    -c "insert into public.schema_migrations (version, checksum) values ('$version', '$checksum');"
  pending=$((pending + 1))
done

if [[ $pending -eq 0 ]]; then
  echo "Database is up to date."
else
  echo "Applied $pending migration(s)."
fi
