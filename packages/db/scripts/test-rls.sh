#!/usr/bin/env bash
# Build a throwaway database, migrate it, seed two organisations, then run the
# isolation suite as the unprivileged application role.
#
#   ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres ./scripts/test-rls.sh
#
# Requires only psql. Exits non-zero on the first failed assertion.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_URL="${ADMIN_URL:-postgres://postgres@127.0.0.1:5432/postgres}"
TEST_DB="${TEST_DB:-stackkeeper_rls_test}"

base_url="${ADMIN_URL%/*}"
admin_db_url="$ADMIN_URL"
test_db_url="$base_url/$TEST_DB"
app_db_url="${base_url/\/\/*@//\/stackkeeper_app@}"
app_db_url="$(sed -E 's#://[^/@]*@#://stackkeeper_app@#' <<<"$test_db_url")"

cleanup() {
  psql "$admin_db_url" -v ON_ERROR_STOP=1 --no-psqlrc --quiet \
    -c "drop database if exists $TEST_DB with (force);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> creating $TEST_DB"
cleanup
psql "$admin_db_url" -v ON_ERROR_STOP=1 --no-psqlrc --quiet -c "create database $TEST_DB;" >/dev/null

echo "==> migrating"
DATABASE_URL="$test_db_url" "$HERE/migrate.sh"

echo "==> granting connect to the application role"
psql "$test_db_url" -v ON_ERROR_STOP=1 --no-psqlrc --quiet \
  -c "grant connect on database $TEST_DB to stackkeeper_app;" >/dev/null

echo "==> seeding two organisations"
psql "$test_db_url" -v ON_ERROR_STOP=1 --no-psqlrc --quiet -f "$HERE/../tests/seed_two_orgs.sql" >/dev/null

echo "==> running isolation suite as stackkeeper_app"
psql "$app_db_url" -v ON_ERROR_STOP=1 --no-psqlrc -f "$HERE/../tests/rls_isolation.sql"
