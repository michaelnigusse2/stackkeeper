-- 0005: shareable, read-only client report links.
--
-- A link lets a client see what is looked after for them, and who owns each
-- account, without signing in. Only a SHA-256 hash of the token is stored, so
-- a copy of the database does not hand out working links. Links always
-- expire, at most a year out, and can be revoked. Nothing is ever deleted:
-- revoking sets revoked_at, so the history of who was shown what survives.

create table app.client_report_link (
  id              uuid not null default gen_random_uuid(),
  org_id          text not null,
  client_id       uuid not null,
  token_hash      bytea not null,
  label           text,
  created_by      text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  last_viewed_at  timestamptz,
  view_count      integer not null default 0,

  constraint client_report_link_pkey primary key (id),
  constraint client_report_link_org_id_key unique (org_id, id),
  constraint client_report_link_token_key unique (token_hash),
  constraint client_report_link_client_fk foreign key (org_id, client_id)
    references app.client (org_id, id) on delete cascade,
  constraint client_report_link_hash_is_sha256 check (octet_length(token_hash) = 32),
  constraint client_report_link_expiry_bounded check (
    expires_at > created_at and expires_at <= created_at + interval '366 days'
  )
);

create index client_report_link_org_client_idx on app.client_report_link (org_id, client_id);

-- No delete: revoking is an update, so the record of what was shared stays.
grant select, insert, update on app.client_report_link to stackkeeper_app;

alter table app.client_report_link enable row level security;
alter table app.client_report_link force row level security;

create policy tenant_isolation on app.client_report_link
  for all
  using (org_id = app.current_org())
  with check (org_id = app.current_org());

-- ---------------------------------------------------------------------------
-- Resolving a token.
--
-- The report page has no session, so it cannot know the organisation before
-- it has looked the token up, and row-level security hides every row until it
-- does. This function is the one narrow door: given the hash of a token, it
-- returns the organisation and client of a link that is live, and counts the
-- view. It reveals nothing about links it does not match, and nothing about
-- revoked or expired ones.
--
-- It runs as the migration owner (security definer), which gets its own
-- policy on this table only. The page then reads the report through the
-- ordinary tenant path, scoped to the organisation returned here.
-- ---------------------------------------------------------------------------

do $$
declare owner_role text := current_user;
begin
  execute format(
    'create policy owner_resolve on app.client_report_link for all to %I using (true) with check (true)',
    owner_role
  );
end
$$;

create function app.resolve_report_link(p_token_hash bytea)
returns table (org_id text, client_id uuid, link_id uuid, expires_at timestamptz)
language sql
volatile
security definer
set search_path = pg_catalog, app
as $$
  update app.client_report_link l
     set last_viewed_at = now(),
         view_count = l.view_count + 1
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and l.expires_at > now()
  returning l.org_id, l.client_id, l.id, l.expires_at
$$;

revoke all on function app.resolve_report_link(bytea) from public;
grant execute on function app.resolve_report_link(bytea) to stackkeeper_app;
