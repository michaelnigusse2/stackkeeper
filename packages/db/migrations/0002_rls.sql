-- 0002_rls.sql
-- Row-level security. This file is the security boundary of the product.
--
-- Model:
--   * Tables are owned by the migration role (the "owner").
--   * The application connects as stackkeeper_app, which owns nothing.
--   * Each request opens a transaction and sets app.org_id with set_config(...,
--     true) so the setting is transaction local and cannot leak across pooled
--     connections.
--   * Every tenant policy compares org_id with app.current_org(). When the
--     setting is absent that function returns NULL, the predicate is NULL
--     rather than true, and the query returns nothing. Fail closed.
--   * FORCE ROW LEVEL SECURITY is set so that even the table owner is subject
--     to the policies. Only a superuser or a role with BYPASSRLS can see past
--     them, and the application role has neither.
--
-- Run this migration as a role with CREATEROLE (or as superuser). In managed
-- Postgres, create the role out of band and re-run: the DO block is a no-op
-- when the role already exists.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'stackkeeper_app') then
    create role stackkeeper_app login;
  end if;
end
$$;

-- The application role must never be able to see past a policy.
alter role stackkeeper_app nobypassrls nosuperuser nocreatedb nocreaterole;

revoke all on schema app from public;
grant usage on schema app to stackkeeper_app;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on
  app.organization_settings,
  app.client,
  app.project,
  app.asset,
  app.cost_line,
  app.credential_ref
to stackkeeper_app;

-- The audit log is append only for the application: no update, no delete.
grant select, insert on app.audit_log to stackkeeper_app;
grant usage, select on sequence app.audit_log_id_seq to stackkeeper_app;

-- Exchange rates are global read-only reference data, written by the worker
-- through the owner role.
grant select on app.fx_rate to stackkeeper_app;

grant execute on function app.current_org() to stackkeeper_app;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table app.organization_settings enable row level security;
alter table app.organization_settings force row level security;
create policy tenant_isolation on app.organization_settings
  for all
  using (org_id = app.current_org())
  with check (org_id = app.current_org());

alter table app.client enable row level security;
alter table app.client force row level security;
create policy tenant_isolation on app.client
  for all
  using (org_id = app.current_org())
  with check (org_id = app.current_org());

alter table app.project enable row level security;
alter table app.project force row level security;
create policy tenant_isolation on app.project
  for all
  using (org_id = app.current_org())
  with check (org_id = app.current_org());

alter table app.asset enable row level security;
alter table app.asset force row level security;
create policy tenant_isolation on app.asset
  for all
  using (org_id = app.current_org())
  with check (org_id = app.current_org());

alter table app.cost_line enable row level security;
alter table app.cost_line force row level security;
create policy tenant_isolation on app.cost_line
  for all
  using (org_id = app.current_org())
  with check (org_id = app.current_org());

alter table app.credential_ref enable row level security;
alter table app.credential_ref force row level security;
create policy tenant_isolation on app.credential_ref
  for all
  using (org_id = app.current_org())
  with check (org_id = app.current_org());

-- The audit log is readable within the organisation and insertable for it.
-- No update or delete policy exists, and no such privilege is granted, so
-- history cannot be rewritten through the application role.
alter table app.audit_log enable row level security;
alter table app.audit_log force row level security;
create policy tenant_read on app.audit_log
  for select
  using (org_id = app.current_org());
create policy tenant_append on app.audit_log
  for insert
  with check (org_id = app.current_org());
