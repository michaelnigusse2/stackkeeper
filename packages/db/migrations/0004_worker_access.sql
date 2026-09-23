-- 0004_worker_access.sql
-- Let the background worker see across organisations, explicitly.
--
-- The monitoring worker is not acting for one customer: it sweeps every due
-- monitor in the system. Row-level security is FORCED on these tables, which
-- means even the table owner is filtered, so without a policy the worker would
-- see nothing at all.
--
-- The alternative would be giving the worker BYPASSRLS, which is a blunt
-- instrument that switches off every policy on every table for that role and
-- leaves no record of why. These policies are narrow and self-documenting
-- instead: one named role, one named set of tables, visible in \d+ output.
--
-- The application role is untouched and stays confined to its own
-- organisation. Nothing here widens what a web request can reach.

do $$
declare
  owner_role text := current_user;
  target text;
begin
  foreach target in array array[
    'monitor', 'check_result', 'alert_event', 'notification_channel',
    'client', 'project', 'asset', 'cost_line', 'organization_settings', 'audit_log'
  ]
  loop
    execute format(
      'create policy worker_access on app.%I for all to %I using (true) with check (true)',
      target, owner_role
    );
  end loop;
end
$$;

-- The worker records exchange rates, so it needs to write the one table that
-- carries no organisation at all.
do $$
declare owner_role text := current_user;
begin
  execute format('grant select, insert, update on app.fx_rate to %I', owner_role);
end
$$;

-- Supports the sweep: which monitors are due, oldest first.
create index if not exists monitor_due_enabled_idx
  on app.monitor (next_check_at)
  where enabled;

-- Supports resolving alerts: find the open one for a monitor and rule.
create index if not exists alert_event_monitor_open_idx
  on app.alert_event (monitor_id, rule)
  where resolved_at is null;
