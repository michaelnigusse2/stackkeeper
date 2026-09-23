#!/usr/bin/env bash
# Mutation test for the isolation suite.
#
# A security test that cannot fail is worse than no test, because it buys
# false confidence. This script breaks the isolation model on purpose, one way
# at a time, and asserts that tests/rls_isolation.sql notices each time.
#
#   ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres ./scripts/test-rls-mutations.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_URL="${ADMIN_URL:-postgres://postgres@127.0.0.1:5432/postgres}"
TEST_DB="${TEST_DB:-stackkeeper_rls_mutation_test}"

base_url="${ADMIN_URL%/*}"
test_db_url="$base_url/$TEST_DB"
app_db_url="$(sed -E 's#://[^/@]*@#://stackkeeper_app@#' <<<"$test_db_url")"

drop_db() {
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 --no-psqlrc --quiet \
    -c "drop database if exists $TEST_DB with (force);" >/dev/null 2>&1 || true
}
trap drop_db EXIT

build_db() {
  drop_db
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 --no-psqlrc --quiet -c "create database $TEST_DB;" >/dev/null
  DATABASE_URL="$test_db_url" "$HERE/migrate.sh" >/dev/null
  psql "$test_db_url" -v ON_ERROR_STOP=1 --no-psqlrc --quiet \
    -c "grant connect on database $TEST_DB to stackkeeper_app;" >/dev/null
  psql "$test_db_url" -v ON_ERROR_STOP=1 --no-psqlrc --quiet \
    -f "$HERE/../tests/seed_two_orgs.sql" >/dev/null
}

suite_passes() {
  psql "$app_db_url" -v ON_ERROR_STOP=1 --no-psqlrc --quiet \
    -f "$HERE/../tests/rls_isolation.sql" >/dev/null 2>&1
}

failures=0

expect_caught() {
  local name="$1" sql="$2"
  build_db
  psql "$test_db_url" -v ON_ERROR_STOP=1 --no-psqlrc --quiet -c "$sql" >/dev/null
  if suite_passes; then
    echo "MISSED   $name  <-- the suite did not notice this break"
    failures=$((failures + 1))
  else
    echo "caught   $name"
  fi
}

echo "==> baseline: an unmutated database must pass"
build_db
if suite_passes; then
  echo "ok       baseline passes"
else
  echo "BROKEN   baseline fails; fix the suite before trusting the mutations"
  exit 1
fi

echo "==> mutations"
expect_caught "policy dropped from app.client" \
  "drop policy tenant_isolation on app.client;"

expect_caught "row-level security disabled on app.asset" \
  "alter table app.asset disable row level security;"

expect_caught "FORCE removed from app.cost_line" \
  "alter table app.cost_line no force row level security;"

expect_caught "policy widened to every row" \
  "drop policy tenant_isolation on app.client;
   create policy tenant_isolation on app.client for all using (true) with check (true);"

expect_caught "new tenant table added without a policy" \
  "create table app.note (id uuid primary key default gen_random_uuid(), org_id text not null, body text);
   grant select, insert on app.note to stackkeeper_app;"

expect_caught "audit log made rewritable" \
  "grant update, delete on app.audit_log to stackkeeper_app;
   create policy tenant_write on app.audit_log for update using (org_id = app.current_org());
   create policy tenant_delete on app.audit_log for delete using (org_id = app.current_org());"

expect_caught "composite foreign key replaced with a single-column one" \
  "alter table app.project drop constraint project_client_fk;
   alter table app.project add constraint project_client_fk
     foreign key (client_id) references app.client (id) on delete cascade;
   alter table app.client drop constraint client_org_id_key cascade;"

expect_caught "application role granted BYPASSRLS" \
  "alter role stackkeeper_app bypassrls;"

expect_caught "a cross-organisation policy attached to the application role" \
  "create policy worker_access_leak on app.client for all to stackkeeper_app using (true) with check (true);"

expect_caught "report resolver ignores revocation" \
  "create or replace function app.resolve_report_link(p_token_hash bytea)
     returns table (org_id text, client_id uuid, link_id uuid, expires_at timestamptz)
     language sql volatile security definer set search_path = pg_catalog, app as
     \$\$ select l.org_id, l.client_id, l.id, l.expires_at from app.client_report_link l
         where l.token_hash = p_token_hash \$\$;"

expect_caught "report links made deletable" \
  "grant delete on app.client_report_link to stackkeeper_app;
   create policy tenant_delete on app.client_report_link for delete using (org_id = app.current_org());"

# Leave the shared role as the migration intends, whatever happened above.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 --no-psqlrc --quiet \
  -c "alter role stackkeeper_app nobypassrls;" >/dev/null

echo
if [[ $failures -eq 0 ]]; then
  echo "All mutations were caught. The isolation suite has teeth."
else
  echo "$failures mutation(s) slipped through. Strengthen tests/rls_isolation.sql."
  exit 1
fi
