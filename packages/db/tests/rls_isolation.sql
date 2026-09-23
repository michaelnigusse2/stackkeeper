-- Tenant isolation test suite. Run as stackkeeper_app against a database that
-- has been migrated and seeded with tests/seed_two_orgs.sql.
--
-- Any failure raises an exception. With ON_ERROR_STOP=1 the script exits
-- non-zero, so this doubles as the CI gate. If this suite passes, one
-- organisation cannot read, change or link to another's rows through the
-- application role.
set client_min_messages = notice;

create or replace function pg_temp.assert(cond boolean, msg text) returns void
  language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'ASSERTION FAILED: %', msg;
  end if;
end $$;

create or replace function pg_temp.assert_eq(actual bigint, expected bigint, msg text) returns void
  language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', msg, expected, actual;
  end if;
end $$;

-- ===========================================================================
-- 1. The application role itself must not be able to see past a policy
-- ===========================================================================
do $$
declare r record;
begin
  select rolsuper, rolbypassrls into r from pg_roles where rolname = current_user;
  perform pg_temp.assert(not r.rolsuper,     'application role must not be superuser');
  perform pg_temp.assert(not r.rolbypassrls, 'application role must not have BYPASSRLS');
  raise notice 'PASS  1. application role has no bypass';
end $$;

-- ===========================================================================
-- 2. Every tenant table must have row-level security enabled AND forced.
--    This catches a table added in a later migration without a policy.
-- ===========================================================================
do $$
declare offenders text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app'
    and c.relkind = 'r'
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'org_id'
        and a.attnum > 0 and not a.attisdropped
    )
    and (not c.relrowsecurity or not c.relforcerowsecurity);

  perform pg_temp.assert(offenders is null,
    format('tables carry org_id but lack forced row-level security: %s', offenders));
  raise notice 'PASS  2. every tenant table forces row-level security';
end $$;

-- ===========================================================================
-- 3. With no organisation set, nothing is visible. Fail closed.
-- ===========================================================================
do $$
declare n bigint;
begin
  perform set_config('app.org_id', '', false);

  select count(*) into n from app.client;              perform pg_temp.assert_eq(n, 0, 'client visible with no org set');
  select count(*) into n from app.project;             perform pg_temp.assert_eq(n, 0, 'project visible with no org set');
  select count(*) into n from app.asset;               perform pg_temp.assert_eq(n, 0, 'asset visible with no org set');
  select count(*) into n from app.cost_line;           perform pg_temp.assert_eq(n, 0, 'cost_line visible with no org set');
  select count(*) into n from app.credential_ref;      perform pg_temp.assert_eq(n, 0, 'credential_ref visible with no org set');
  select count(*) into n from app.monitor;             perform pg_temp.assert_eq(n, 0, 'monitor visible with no org set');
  select count(*) into n from app.check_result;        perform pg_temp.assert_eq(n, 0, 'check_result visible with no org set');
  select count(*) into n from app.alert_event;         perform pg_temp.assert_eq(n, 0, 'alert_event visible with no org set');
  select count(*) into n from app.notification_channel;perform pg_temp.assert_eq(n, 0, 'notification_channel visible with no org set');
  select count(*) into n from app.audit_log;           perform pg_temp.assert_eq(n, 0, 'audit_log visible with no org set');
  select count(*) into n from app.organization_settings; perform pg_temp.assert_eq(n, 0, 'settings visible with no org set');

  raise notice 'PASS  3. unscoped connection sees nothing';
end $$;

-- ===========================================================================
-- 4. Scoped to org_a, exactly org_a's rows are visible, on every table
-- ===========================================================================
do $$
declare n bigint; nm text;
begin
  perform set_config('app.org_id', 'org_a', false);

  select count(*) into n from app.client;               perform pg_temp.assert_eq(n, 1, 'org_a should see one client');
  select name into nm from app.client;                  perform pg_temp.assert(nm = 'Acme Bakery', 'org_a saw the wrong client');
  select count(*) into n from app.project;              perform pg_temp.assert_eq(n, 1, 'org_a should see one project');
  select count(*) into n from app.asset;                perform pg_temp.assert_eq(n, 1, 'org_a should see one asset');
  select count(*) into n from app.cost_line;            perform pg_temp.assert_eq(n, 1, 'org_a should see one cost line');
  select count(*) into n from app.credential_ref;       perform pg_temp.assert_eq(n, 1, 'org_a should see one credential ref');
  select count(*) into n from app.monitor;              perform pg_temp.assert_eq(n, 1, 'org_a should see one monitor');
  select count(*) into n from app.check_result;         perform pg_temp.assert_eq(n, 1, 'org_a should see one check result');
  select count(*) into n from app.alert_event;          perform pg_temp.assert_eq(n, 1, 'org_a should see one alert');
  select count(*) into n from app.notification_channel; perform pg_temp.assert_eq(n, 1, 'org_a should see one channel');
  select count(*) into n from app.audit_log;            perform pg_temp.assert_eq(n, 1, 'org_a should see one audit row');
  select count(*) into n from app.organization_settings;perform pg_temp.assert_eq(n, 1, 'org_a should see its settings');

  raise notice 'PASS  4. org_a sees only its own rows';
end $$;

-- ===========================================================================
-- 5. Naming another organisation's primary key does not reveal it
-- ===========================================================================
do $$
declare n bigint;
begin
  perform set_config('app.org_id', 'org_a', false);

  select count(*) into n from app.client where id = 'bbbbbbbb-0000-4000-8000-000000000001';
  perform pg_temp.assert_eq(n, 0, 'org_a read org_b client by id');

  select count(*) into n from app.credential_ref where id = 'bbbbbbbb-0000-4000-8000-000000000005';
  perform pg_temp.assert_eq(n, 0, 'org_a read org_b credential reference by id');

  raise notice 'PASS  5. direct id lookup across tenants returns nothing';
end $$;

-- ===========================================================================
-- 6. Writes against another organisation's rows affect nothing
-- ===========================================================================
do $$
declare affected bigint;
begin
  perform set_config('app.org_id', 'org_a', false);

  update app.client set name = 'hijacked' where id = 'bbbbbbbb-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  perform pg_temp.assert_eq(affected, 0, 'org_a updated an org_b client');

  delete from app.client where id = 'bbbbbbbb-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  perform pg_temp.assert_eq(affected, 0, 'org_a deleted an org_b client');

  update app.cost_line set charge_amount = 1 where org_id = 'org_b';
  get diagnostics affected = row_count;
  perform pg_temp.assert_eq(affected, 0, 'org_a updated an org_b cost line');

  raise notice 'PASS  6. cross-tenant update and delete affect no rows';
end $$;

-- ===========================================================================
-- 7. Writing a row that belongs to another organisation is rejected
-- ===========================================================================
do $$
declare rejected boolean := false;
begin
  perform set_config('app.org_id', 'org_a', false);
  begin
    insert into app.client (org_id, name) values ('org_b', 'planted by org_a');
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert(rejected, 'insert into another organisation was allowed');
  raise notice 'PASS  7. insert for another organisation is rejected';
end $$;

-- ===========================================================================
-- 8. A row cannot be moved out of the organisation that owns it
-- ===========================================================================
do $$
declare rejected boolean := false;
begin
  perform set_config('app.org_id', 'org_a', false);
  begin
    update app.client set org_id = 'org_b' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert(rejected, 'a row was moved to another organisation');
  raise notice 'PASS  8. rows cannot be reassigned to another organisation';
end $$;

-- ===========================================================================
-- 9. Composite foreign keys stop a child pointing at another tenant's parent.
--    This holds even if the policies above were dropped.
-- ===========================================================================
do $$
declare rejected boolean := false;
begin
  perform set_config('app.org_id', 'org_a', false);
  begin
    insert into app.project (org_id, client_id, name)
    values ('org_a', 'bbbbbbbb-0000-4000-8000-000000000001', 'project on a stolen client');
  exception when foreign_key_violation then
    rejected := true;
  end;
  perform pg_temp.assert(rejected, 'a project was linked to another organisation''s client');

  rejected := false;
  begin
    insert into app.asset (org_id, client_id, kind, label)
    values ('org_a', 'bbbbbbbb-0000-4000-8000-000000000001', 'server', 'asset on a stolen client');
  exception when foreign_key_violation then
    rejected := true;
  end;
  perform pg_temp.assert(rejected, 'an asset was linked to another organisation''s client');

  raise notice 'PASS  9. composite foreign keys block cross-tenant links';
end $$;

-- ===========================================================================
-- 10. The audit log is append only for the application role
-- ===========================================================================
do $$
declare rejected boolean := false; n bigint;
begin
  perform set_config('app.org_id', 'org_a', false);

  insert into app.audit_log (org_id, actor_user_id, action) values ('org_a', 'user_a', 'test.append');
  select count(*) into n from app.audit_log;
  perform pg_temp.assert_eq(n, 2, 'append to own audit log failed');

  begin
    update app.audit_log set action = 'rewritten' where org_id = 'org_a';
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert(rejected, 'audit log was updatable');

  rejected := false;
  begin
    delete from app.audit_log where org_id = 'org_a';
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert(rejected, 'audit log was deletable');

  rejected := false;
  begin
    insert into app.audit_log (org_id, action) values ('org_b', 'planted');
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert(rejected, 'audit row was written for another organisation');

  raise notice 'PASS 10. audit log is append only and tenant scoped';
end $$;

-- ===========================================================================
-- 11. Check results are append only and tenant scoped
-- ===========================================================================
do $$
declare rejected boolean := false;
begin
  perform set_config('app.org_id', 'org_a', false);
  begin
    insert into app.check_result (org_id, monitor_id, status)
    values ('org_b', 'bbbbbbbb-0000-4000-8000-000000000006', 'ok');
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert(rejected, 'check result written for another organisation');

  rejected := false;
  begin
    delete from app.check_result;
  exception when insufficient_privilege then
    rejected := true;
  end;
  perform pg_temp.assert(rejected, 'check results were deletable');

  raise notice 'PASS 11. check results are append only';
end $$;

-- ===========================================================================
-- 12. Switching organisation switches the whole view
-- ===========================================================================
do $$
declare nm text; n bigint;
begin
  perform set_config('app.org_id', 'org_b', false);
  select count(*) into n from app.client;
  perform pg_temp.assert_eq(n, 1, 'org_b should see one client');
  select name into nm from app.client;
  perform pg_temp.assert(nm = 'Borealis Labs', 'org_b saw the wrong client');

  select count(*) into n from app.client where name = 'Acme Bakery';
  perform pg_temp.assert_eq(n, 0, 'org_b saw an org_a client');

  raise notice 'PASS 12. switching organisation switches the visible rows';
end $$;

-- ===========================================================================
-- 13. Global reference data stays readable regardless of organisation
-- ===========================================================================
do $$
declare n bigint;
begin
  perform set_config('app.org_id', '', false);
  select count(*) into n from app.fx_rate;  -- readable, empty is fine
  perform pg_temp.assert(n >= 0, 'exchange rates unreadable');
  raise notice 'PASS 13. exchange rates are readable without an organisation';
end $$;

-- ===========================================================================
-- 14. No policy hands the application role unrestricted access.
--     Migration 0004 gives the worker a cross-organisation policy. This makes
--     sure such a policy is never attached to the role that serves web
--     requests, whether by accident or by a later edit.
-- ===========================================================================
do $$
declare offenders text;
begin
  select string_agg(format('%s on %s', policyname, tablename), ', ' order by tablename)
  into offenders
  from pg_policies
  where schemaname = 'app'
    and (qual = 'true' or with_check = 'true')
    and ('stackkeeper_app' = any(roles) or 'public' = any(roles));

  perform pg_temp.assert(offenders is null,
    format('an unrestricted policy reaches the application role: %s', offenders));
  raise notice 'PASS 14. no unrestricted policy reaches the application role';
end $$;

select 'ALL TENANT ISOLATION TESTS PASSED' as result;
