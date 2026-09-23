-- 0003_monitoring.sql
-- Tables for the monitoring engine (Phase 2). Created now so the worker has
-- ground to stand on and so tenant isolation is proven across every table at
-- once rather than retro-fitted later.
--
-- Alert design note: certificate alerts are relative to the share of lifetime
-- used, not a fixed number of days. Maximum certificate validity falls to 100
-- days in March 2027 and 47 days in March 2029, and Let's Encrypt already
-- issues 6-day certificates, so a fixed "warn 30 days before expiry" rule
-- would fire permanently. check_result.payload therefore records not_before as
-- well as not_after, so lifetime_used can be computed from stored data.

create type app.monitor_kind as enum ('domain_expiry', 'tls', 'dns');

create type app.monitor_state as enum ('unknown', 'ok', 'warning', 'critical', 'error');

create type app.check_status as enum ('ok', 'warning', 'critical', 'error');

create type app.alert_severity as enum ('info', 'warning', 'critical');

create type app.channel_kind as enum ('email', 'slack', 'discord', 'telegram', 'webhook');

-- ---------------------------------------------------------------------------
-- Monitors
-- ---------------------------------------------------------------------------

create table app.monitor (
  id                   uuid not null default gen_random_uuid(),
  org_id               text not null,
  asset_id             uuid not null,
  kind                 app.monitor_kind not null,
  target               text not null,
  enabled              boolean not null default true,
  state                app.monitor_state not null default 'unknown',
  -- Set when the registry publishes no expiry date (.de, .nl, .et and others),
  -- so the interface can show an "unverifiable, entered by hand" badge instead
  -- of implying the date was confirmed upstream.
  expiry_is_manual     boolean not null default false,
  manual_expires_at    date,
  last_checked_at      timestamptz,
  next_check_at        timestamptz not null default now(),
  consecutive_failures integer not null default 0,
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint monitor_pkey primary key (id),
  constraint monitor_org_id_key unique (org_id, id),
  constraint monitor_asset_fk foreign key (org_id, asset_id)
    references app.asset (org_id, id) on delete cascade,
  constraint monitor_target_not_blank check (length(btrim(target)) > 0),
  constraint monitor_unique_per_asset unique (org_id, asset_id, kind, target)
);

-- The worker's claim query: due, enabled monitors in target order.
create index monitor_due_idx on app.monitor (next_check_at) where enabled;
create index monitor_org_state_idx on app.monitor (org_id, state);

create trigger monitor_touch
  before update on app.monitor
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Check results: append only, high volume
-- ---------------------------------------------------------------------------

create table app.check_result (
  id         bigint generated always as identity primary key,
  org_id     text not null,
  monitor_id uuid not null,
  checked_at timestamptz not null default now(),
  status     app.check_status not null,
  latency_ms integer,
  -- For tls: not_before, not_after, issuer, serial, fingerprint, sans,
  --          chain_valid, hostname_match, resolved_ip.
  -- For domain_expiry: expires_at, registrar, statuses, nameservers,
  --          source ('rdap' | 'whois' | 'manual'), auto_renew_suspected.
  payload    jsonb not null default '{}'::jsonb,

  constraint check_result_monitor_fk foreign key (org_id, monitor_id)
    references app.monitor (org_id, id) on delete cascade,
  constraint check_result_payload_is_object check (jsonb_typeof(payload) = 'object')
);

create index check_result_monitor_time_idx on app.check_result (monitor_id, checked_at desc);
create index check_result_org_time_idx on app.check_result (org_id, checked_at desc);

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------

create table app.alert_event (
  id          uuid not null default gen_random_uuid(),
  org_id      text not null,
  monitor_id  uuid,
  asset_id    uuid,
  severity    app.alert_severity not null,
  rule        text not null,
  -- Deduplication key, for example 'tls:<fingerprint>:lifetime_75'. One open
  -- alert per key, so a wildcard certificate on forty hostnames alerts once.
  dedupe_key  text not null,
  message     text not null,
  data        jsonb not null default '{}'::jsonb,
  opened_at   timestamptz not null default now(),
  notified_at timestamptz,
  resolved_at timestamptz,
  -- Set while a domain sits in the registry auto-renew grace period, where the
  -- published expiry date has rolled forward a year but nobody has confirmed
  -- that the renewal was actually paid for.
  needs_payment_confirmation boolean not null default false,

  constraint alert_event_pkey primary key (id),
  constraint alert_event_org_id_key unique (org_id, id),
  constraint alert_event_monitor_fk foreign key (org_id, monitor_id)
    references app.monitor (org_id, id) on delete cascade,
  constraint alert_event_asset_fk foreign key (org_id, asset_id)
    references app.asset (org_id, id) on delete cascade
);

create unique index alert_event_open_dedupe_idx
  on app.alert_event (org_id, dedupe_key)
  where resolved_at is null;
create index alert_event_org_open_idx on app.alert_event (org_id, opened_at desc) where resolved_at is null;

-- ---------------------------------------------------------------------------
-- Notification channels
-- ---------------------------------------------------------------------------

create table app.notification_channel (
  id         uuid not null default gen_random_uuid(),
  org_id     text not null,
  kind       app.channel_kind not null,
  label      text not null,
  -- Non-secret settings only: channel name, minimum severity, client filter.
  config     jsonb not null default '{}'::jsonb,
  -- Envelope-encrypted payload for the parts that authenticate: a Slack or
  -- Discord webhook URL, a Telegram bot token. Encrypted in application code
  -- with a per-organisation data key; the database never sees plaintext.
  secret     bytea,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_channel_pkey primary key (id),
  constraint notification_channel_org_id_key unique (org_id, id),
  constraint notification_channel_label_not_blank check (length(btrim(label)) > 0),
  constraint notification_channel_config_is_object check (jsonb_typeof(config) = 'object')
);

create index notification_channel_org_idx on app.notification_channel (org_id) where enabled;

create trigger notification_channel_touch
  before update on app.notification_channel
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and policies
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on
  app.monitor,
  app.alert_event,
  app.notification_channel
to stackkeeper_app;

grant select, insert on app.check_result to stackkeeper_app;
grant usage, select on sequence app.check_result_id_seq to stackkeeper_app;

alter table app.monitor enable row level security;
alter table app.monitor force row level security;
create policy tenant_isolation on app.monitor
  for all
  using (org_id = app.current_org())
  with check (org_id = app.current_org());

alter table app.check_result enable row level security;
alter table app.check_result force row level security;
create policy tenant_read on app.check_result
  for select
  using (org_id = app.current_org());
create policy tenant_append on app.check_result
  for insert
  with check (org_id = app.current_org());

alter table app.alert_event enable row level security;
alter table app.alert_event force row level security;
create policy tenant_isolation on app.alert_event
  for all
  using (org_id = app.current_org())
  with check (org_id = app.current_org());

alter table app.notification_channel enable row level security;
alter table app.notification_channel force row level security;
create policy tenant_isolation on app.notification_channel
  for all
  using (org_id = app.current_org())
  with check (org_id = app.current_org());
