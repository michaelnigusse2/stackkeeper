-- 0001_init.sql
-- Core application schema for Stackkeeper.
--
-- Design rules enforced here:
--   1. Every tenant table carries org_id and a UNIQUE (org_id, id) key.
--   2. Every foreign key between tenant tables is composite: (org_id, parent_id)
--      references parent (org_id, id). A child can therefore never point at a
--      parent in another organisation, even if row-level security were removed.
--   3. Money is stored as integer minor units plus an ISO-4217 currency code.
--      Never floating point.
--   4. All timestamps are timestamptz and stored in UTC.
--   5. Client-facing records are soft deleted, then purged by a background job.
--
-- Auth tables (user, session, organization, member, ...) are NOT defined here.
-- They live in the "auth" schema and are owned by Better Auth's own migration
-- CLI, so that this file never has to guess that library's column names.
-- app.org_id values reference auth."organization".id by convention, without a
-- cross-schema foreign key.

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type app.client_status as enum ('prospect', 'active', 'paused', 'former');

create type app.project_status as enum ('planning', 'active', 'maintenance', 'handed_over', 'archived');

create type app.asset_kind as enum (
  'server', 'domain', 'certificate', 'hosting', 'dns', 'email',
  'saas', 'license', 'cdn', 'database', 'storage', 'other'
);

create type app.asset_status as enum ('active', 'pending', 'suspended', 'cancelled', 'transferred');

create type app.asset_source as enum ('manual', 'csv', 'import', 'discovered');

-- The ownership register. Answering "who owns this, who pays for it, who is
-- the registrant, and who holds the keys" is the product's core differentiator.
create type app.party as enum ('agency', 'client', 'third_party', 'unknown');

create type app.billing_cycle as enum (
  'once', 'monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'triennial'
);

create type app.credential_kind as enum (
  'login', 'ssh_key', 'api_token', 'totp', 'recovery_code', 'note', 'other'
);

create type app.credential_manager as enum (
  'onepassword', 'bitwarden', 'proton_pass', 'keepassxc', 'dashlane', 'other'
);

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Returns the organisation id for the current transaction, or NULL when unset.
-- NULL makes every tenant predicate evaluate to NULL, which is not true, so an
-- unscoped connection sees nothing. Fail closed, never fail open.
create or replace function app.current_org() returns text
  language sql
  stable
as $$
  select nullif(current_setting('app.org_id', true), '')
$$;

create or replace function app.touch_updated_at() returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Organisation settings
-- ---------------------------------------------------------------------------

create table app.organization_settings (
  org_id             text primary key,
  reporting_currency char(3) not null default 'USD',
  plan               text    not null default 'free',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint organization_settings_currency_upper check (reporting_currency = upper(reporting_currency))
);

create trigger organization_settings_touch
  before update on app.organization_settings
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------

create table app.client (
  id                    uuid not null default gen_random_uuid(),
  org_id                text not null,
  name                  text not null,
  status                app.client_status not null default 'active',
  notes                 text,
  primary_contact_name  text,
  primary_contact_email text,
  primary_contact_phone text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  constraint client_pkey primary key (id),
  constraint client_org_id_key unique (org_id, id),
  constraint client_name_not_blank check (length(btrim(name)) > 0)
);

create index client_org_idx on app.client (org_id) where deleted_at is null;
create unique index client_org_name_idx on app.client (org_id, lower(btrim(name))) where deleted_at is null;

create trigger client_touch
  before update on app.client
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

create table app.project (
  id          uuid not null default gen_random_uuid(),
  org_id      text not null,
  client_id   uuid not null,
  name        text not null,
  status      app.project_status not null default 'active',
  description text,
  repo_url    text,
  live_url    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint project_pkey primary key (id),
  constraint project_org_id_key unique (org_id, id),
  constraint project_client_fk foreign key (org_id, client_id)
    references app.client (org_id, id) on delete cascade,
  constraint project_name_not_blank check (length(btrim(name)) > 0)
);

create index project_org_client_idx on app.project (org_id, client_id) where deleted_at is null;

create trigger project_touch
  before update on app.project
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------------

create table app.asset (
  id             uuid not null default gen_random_uuid(),
  org_id         text not null,
  client_id      uuid not null,
  project_id     uuid,
  kind           app.asset_kind not null,
  label          text not null,
  provider       text,
  identifier     text,
  region         text,
  plan_name      text,
  status         app.asset_status not null default 'active',
  source         app.asset_source not null default 'manual',
  external_id    text,
  expires_at     timestamptz,
  details        jsonb not null default '{}'::jsonb,

  -- Ownership register
  account_owner  app.party not null default 'unknown',
  payer          app.party not null default 'unknown',
  registrant     app.party not null default 'unknown',
  access_holder  app.party not null default 'unknown',
  ownership_note text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint asset_pkey primary key (id),
  constraint asset_org_id_key unique (org_id, id),
  constraint asset_client_fk foreign key (org_id, client_id)
    references app.client (org_id, id) on delete cascade,
  constraint asset_project_fk foreign key (org_id, project_id)
    references app.project (org_id, id) on delete set null,
  constraint asset_label_not_blank check (length(btrim(label)) > 0),
  constraint asset_details_is_object check (jsonb_typeof(details) = 'object')
);

create index asset_org_client_idx on app.asset (org_id, client_id) where deleted_at is null;
create index asset_org_kind_idx on app.asset (org_id, kind) where deleted_at is null;
create index asset_org_expires_idx on app.asset (org_id, expires_at) where deleted_at is null and expires_at is not null;
create unique index asset_org_provider_external_idx
  on app.asset (org_id, provider, external_id)
  where external_id is not null and deleted_at is null;

create trigger asset_touch
  before update on app.asset
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Cost lines: what we pay, and what the client is charged
-- ---------------------------------------------------------------------------

create table app.cost_line (
  id              uuid not null default gen_random_uuid(),
  org_id          text not null,
  asset_id        uuid not null,

  cost_amount     bigint not null,
  cost_currency   char(3) not null,
  cost_cycle      app.billing_cycle not null,

  charge_amount   bigint,
  charge_currency char(3),
  charge_cycle    app.billing_cycle,

  billed          boolean not null default false,
  billed_via      text,
  next_renewal    date,
  started_on      date,
  ended_on        date,
  note            text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint cost_line_pkey primary key (id),
  constraint cost_line_org_id_key unique (org_id, id),
  constraint cost_line_asset_fk foreign key (org_id, asset_id)
    references app.asset (org_id, id) on delete cascade,
  constraint cost_line_cost_non_negative check (cost_amount >= 0),
  constraint cost_line_charge_non_negative check (charge_amount is null or charge_amount >= 0),
  constraint cost_line_cost_currency_upper check (cost_currency = upper(cost_currency)),
  constraint cost_line_charge_currency_upper check (charge_currency is null or charge_currency = upper(charge_currency)),
  -- A charge is all-or-nothing: amount, currency and cycle travel together.
  constraint cost_line_charge_complete check (
    (charge_amount is null and charge_currency is null and charge_cycle is null)
    or (charge_amount is not null and charge_currency is not null and charge_cycle is not null)
  ),
  constraint cost_line_dates_ordered check (ended_on is null or started_on is null or ended_on >= started_on)
);

create index cost_line_org_asset_idx on app.cost_line (org_id, asset_id);
create index cost_line_org_renewal_idx on app.cost_line (org_id, next_renewal) where next_renewal is not null;
-- Supports the "paid for but never billed" report, the product's core hook.
create index cost_line_org_unbilled_idx on app.cost_line (org_id) where charge_amount is null or billed = false;

create trigger cost_line_touch
  before update on app.cost_line
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Credential references: pointers only, never secrets
-- ---------------------------------------------------------------------------

create table app.credential_ref (
  id         uuid not null default gen_random_uuid(),
  org_id     text not null,
  asset_id   uuid,
  client_id  uuid not null,
  label      text not null,
  kind       app.credential_kind not null default 'login',
  manager    app.credential_manager not null default 'other',
  reference  text,
  holder     app.party not null default 'agency',
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint credential_ref_pkey primary key (id),
  constraint credential_ref_org_id_key unique (org_id, id),
  constraint credential_ref_client_fk foreign key (org_id, client_id)
    references app.client (org_id, id) on delete cascade,
  constraint credential_ref_asset_fk foreign key (org_id, asset_id)
    references app.asset (org_id, id) on delete cascade,
  constraint credential_ref_label_not_blank check (length(btrim(label)) > 0),
  -- Cheap structural guard. The real check is the browser-side secret scanner;
  -- this only stops the most obvious paste of a private key into a pointer.
  constraint credential_ref_looks_like_pointer check (
    reference is null or (
      length(reference) <= 512
      and reference !~ '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    )
  )
);

create index credential_ref_org_client_idx on app.credential_ref (org_id, client_id);
create index credential_ref_org_asset_idx on app.credential_ref (org_id, asset_id) where asset_id is not null;

create trigger credential_ref_touch
  before update on app.credential_ref
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Foreign exchange rates: global reference data, not tenant scoped
-- ---------------------------------------------------------------------------

create table app.fx_rate (
  as_of date    not null,
  base  char(3) not null,
  quote char(3) not null,
  rate  numeric(20, 10) not null,
  constraint fx_rate_pkey primary key (as_of, base, quote),
  constraint fx_rate_positive check (rate > 0),
  constraint fx_rate_base_upper check (base = upper(base)),
  constraint fx_rate_quote_upper check (quote = upper(quote))
);

-- ---------------------------------------------------------------------------
-- Audit log: append only
-- ---------------------------------------------------------------------------

create table app.audit_log (
  id            bigint generated always as identity primary key,
  org_id        text not null,
  actor_user_id text,
  action        text not null,
  target_type   text,
  target_id     text,
  ip            inet,
  user_agent    text,
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index audit_log_org_created_idx on app.audit_log (org_id, created_at desc);
