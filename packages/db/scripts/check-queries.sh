#!/usr/bin/env bash
# Parse every repository query against a real, migrated database.
#
# PREPARE makes Postgres parse and plan a statement without running it, so a
# misspelled column, a wrong join or a renamed enum fails here rather than in
# production. Cheap, fast, and it needs no test data.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_URL="${ADMIN_URL:-postgres://postgres@127.0.0.1:5432/postgres}"
TEST_DB="${TEST_DB:-stackkeeper_query_check}"
base_url="${ADMIN_URL%/*}"
test_db_url="$base_url/$TEST_DB"

cleanup() {
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 --no-psqlrc --quiet \
    -c "drop database if exists $TEST_DB with (force);" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 --no-psqlrc --quiet -c "create database $TEST_DB;" >/dev/null
DATABASE_URL="$test_db_url" "$HERE/migrate.sh" >/dev/null

python3 "$HERE/extract-queries.py" > /tmp/stackkeeper-queries.sql
total=$(grep -c '^prepare ' /tmp/stackkeeper-queries.sql)
echo "==> checking $total queries against the schema"

if psql "$test_db_url" -v ON_ERROR_STOP=1 --no-psqlrc --quiet -f /tmp/stackkeeper-queries.sql; then
  echo "All $total queries parse and plan against the current schema."
else
  echo "A query failed to prepare. See the error above." >&2
  exit 1
fi
