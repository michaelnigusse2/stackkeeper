import type { JsonObject } from "@stackkeeper/core";
import type { Sql } from "../sql.ts";

/**
 * Monitors, check results and alerts.
 *
 * Functions taking `ownerTx` run on the worker's connection, which migration
 * 0004 gives an explicit cross-organisation policy. Everything else takes a
 * tenant transaction and is confined to one workspace by the database.
 */

export type MonitorKind = "domain_expiry" | "tls" | "dns";
export type MonitorState = "unknown" | "ok" | "warning" | "critical" | "error";
export type CheckStatus = "ok" | "warning" | "critical" | "error";
export type AlertSeverity = "info" | "warning" | "critical";
export type ChannelKind = "email" | "slack" | "discord" | "telegram" | "webhook";

export interface MonitorRow {
  id: string;
  org_id: string;
  asset_id: string;
  kind: MonitorKind;
  target: string;
  enabled: boolean;
  state: MonitorState;
  expiry_is_manual: boolean;
  manual_expires_at: Date | string | null;
  last_checked_at: Date | null;
  next_check_at: Date;
  consecutive_failures: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AlertEventRow {
  id: string;
  org_id: string;
  monitor_id: string | null;
  asset_id: string | null;
  severity: AlertSeverity;
  rule: string;
  dedupe_key: string;
  message: string;
  data: JsonObject;
  opened_at: Date;
  notified_at: Date | null;
  resolved_at: Date | null;
  needs_payment_confirmation: boolean;
}

export interface NotificationChannelRow {
  id: string;
  org_id: string;
  kind: ChannelKind;
  label: string;
  config: JsonObject;
  secret: Buffer | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Worker side: across organisations
// ---------------------------------------------------------------------------

/**
 * Take the monitors that are due and push their next check out immediately,
 * so a second sweep starting before this one finishes cannot pick up the same
 * rows. The real next time is set once the check completes.
 */
export async function claimDueMonitors(
  ownerTx: Sql,
  limit = 200,
  leaseMinutes = 15,
): Promise<MonitorRow[]> {
  return ownerTx<MonitorRow[]>`
    update app.monitor set next_check_at = now() + make_interval(mins => ${leaseMinutes})
    where id in (
      select id from app.monitor
      where enabled and next_check_at <= now()
      order by next_check_at
      limit ${limit}
      for update skip locked
    )
    returning *
  `;
}

export async function recordCheck(
  ownerTx: Sql,
  input: {
    orgId: string;
    monitorId: string;
    status: CheckStatus;
    latencyMs: number | null;
    payload: JsonObject;
  },
): Promise<void> {
  await ownerTx`
    insert into app.check_result (org_id, monitor_id, status, latency_ms, payload)
    values (${input.orgId}, ${input.monitorId}, ${input.status}, ${input.latencyMs}, ${ownerTx.json(input.payload)})
  `;
}

/** The payload from the previous check, for spotting what changed. */
export async function previousCheck(
  ownerTx: Sql,
  monitorId: string,
): Promise<JsonObject | null> {
  const rows = await ownerTx<Array<{ payload: JsonObject }>>`
    select payload from app.check_result
    where monitor_id = ${monitorId}
    order by checked_at desc
    offset 1
    limit 1
  `;
  return rows[0]?.payload ?? null;
}

export async function updateMonitorAfterCheck(
  ownerTx: Sql,
  input: {
    monitorId: string;
    state: MonitorState;
    nextCheckAt: Date;
    error: string | null;
  },
): Promise<void> {
  await ownerTx`
    update app.monitor set
      state = ${input.state},
      last_checked_at = now(),
      next_check_at = ${input.nextCheckAt},
      last_error = ${input.error},
      consecutive_failures = case when ${input.state} = 'error'
        then consecutive_failures + 1 else 0 end
    where id = ${input.monitorId}
  `;
}

/**
 * Open an alert, unless the same one is already open.
 *
 * The unique index on (org_id, dedupe_key) where resolved_at is null does the
 * work, so a wildcard certificate covering forty hostnames raises one alert
 * rather than forty.
 */
export async function openAlert(
  ownerTx: Sql,
  input: {
    orgId: string;
    monitorId: string;
    assetId: string | null;
    severity: AlertSeverity;
    rule: string;
    dedupeKey: string;
    message: string;
    data?: JsonObject;
    needsPaymentConfirmation?: boolean;
  },
): Promise<AlertEventRow | null> {
  const rows = await ownerTx<AlertEventRow[]>`
    insert into app.alert_event (
      org_id, monitor_id, asset_id, severity, rule, dedupe_key, message, data,
      needs_payment_confirmation
    ) values (
      ${input.orgId}, ${input.monitorId}, ${input.assetId}, ${input.severity},
      ${input.rule}, ${input.dedupeKey}, ${input.message},
      ${ownerTx.json(input.data ?? {})}, ${input.needsPaymentConfirmation ?? false}
    )
    on conflict do nothing
    returning *
  `;
  return rows[0] ?? null;
}

/** Close any open alert for this monitor whose rule no longer applies. */
export async function resolveClearedAlerts(
  ownerTx: Sql,
  monitorId: string,
  stillActiveRules: readonly string[],
): Promise<number> {
  const rows = await ownerTx`
    update app.alert_event set resolved_at = now()
    where monitor_id = ${monitorId}
      and resolved_at is null
      and not (rule = any(${stillActiveRules as string[]}::text[]))
    returning id
  `;
  return rows.length;
}

/** Alerts that have been opened but not yet sent anywhere. */
export async function alertsAwaitingDelivery(ownerTx: Sql, limit = 100): Promise<AlertEventRow[]> {
  return ownerTx<AlertEventRow[]>`
    select * from app.alert_event
    where notified_at is null and resolved_at is null
    order by opened_at
    limit ${limit}
  `;
}

export async function markAlertNotified(ownerTx: Sql, alertId: string): Promise<void> {
  await ownerTx`update app.alert_event set notified_at = now() where id = ${alertId}`;
}

export async function channelsForOrganization(
  ownerTx: Sql,
  orgId: string,
): Promise<NotificationChannelRow[]> {
  return ownerTx<NotificationChannelRow[]>`
    select * from app.notification_channel where org_id = ${orgId} and enabled
  `;
}

/** The asset an alert belongs to, for writing a message a person understands. */
export async function alertContext(
  ownerTx: Sql,
  alertId: string,
): Promise<{ asset_label: string | null; client_name: string | null; target: string } | null> {
  const rows = await ownerTx<
    Array<{ asset_label: string | null; client_name: string | null; target: string }>
  >`
    select a.label as asset_label, c.name as client_name, m.target
    from app.alert_event e
    join app.monitor m on m.id = e.monitor_id
    left join app.asset a on a.id = m.asset_id
    left join app.client c on c.id = a.client_id
    where e.id = ${alertId}
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Application side: one organisation
// ---------------------------------------------------------------------------

export async function listMonitors(tx: Sql, orgId: string): Promise<MonitorRow[]> {
  return tx<MonitorRow[]>`
    select * from app.monitor where org_id = ${orgId} order by state desc, target
  `;
}

export async function monitorsForAsset(tx: Sql, assetId: string): Promise<MonitorRow[]> {
  return tx<MonitorRow[]>`select * from app.monitor where asset_id = ${assetId} order by kind`;
}

/** Create a monitor, or leave the existing one alone. */
export async function ensureMonitor(
  tx: Sql,
  orgId: string,
  input: { assetId: string; kind: MonitorKind; target: string },
): Promise<MonitorRow | null> {
  const rows = await tx<MonitorRow[]>`
    insert into app.monitor (org_id, asset_id, kind, target)
    values (${orgId}, ${input.assetId}, ${input.kind}, ${input.target})
    on conflict (org_id, asset_id, kind, target) do nothing
    returning *
  `;
  return rows[0] ?? null;
}

export async function setMonitorEnabled(
  tx: Sql,
  monitorId: string,
  enabled: boolean,
): Promise<void> {
  await tx`update app.monitor set enabled = ${enabled} where id = ${monitorId}`;
}

export async function setManualExpiry(
  tx: Sql,
  monitorId: string,
  expiresOn: string | null,
): Promise<void> {
  await tx`
    update app.monitor set
      manual_expires_at = ${expiresOn}::date,
      expiry_is_manual = ${expiresOn !== null}
    where id = ${monitorId}
  `;
}

export async function deleteMonitor(tx: Sql, monitorId: string): Promise<void> {
  await tx`delete from app.monitor where id = ${monitorId}`;
}

export interface AlertWithContext extends AlertEventRow {
  asset_label: string | null;
  client_id: string | null;
  client_name: string | null;
}

export async function listOpenAlerts(tx: Sql, orgId: string): Promise<AlertWithContext[]> {
  return tx<AlertWithContext[]>`
    select e.*, a.label as asset_label, a.client_id, c.name as client_name
    from app.alert_event e
    left join app.asset a on a.org_id = e.org_id and a.id = e.asset_id
    left join app.client c on c.org_id = e.org_id and c.id = a.client_id
    where e.org_id = ${orgId} and e.resolved_at is null
    order by
      case e.severity when 'critical' then 0 when 'warning' then 1 else 2 end,
      e.opened_at desc
  `;
}

export async function listRecentAlerts(
  tx: Sql,
  orgId: string,
  limit = 50,
): Promise<AlertWithContext[]> {
  return tx<AlertWithContext[]>`
    select e.*, a.label as asset_label, a.client_id, c.name as client_name
    from app.alert_event e
    left join app.asset a on a.org_id = e.org_id and a.id = e.asset_id
    left join app.client c on c.org_id = e.org_id and c.id = a.client_id
    where e.org_id = ${orgId}
    order by e.opened_at desc
    limit ${limit}
  `;
}

/** Acknowledge an alert by hand, for the ones a person has dealt with. */
export async function acknowledgeAlert(tx: Sql, alertId: string): Promise<boolean> {
  const rows = await tx`
    update app.alert_event set resolved_at = now()
    where id = ${alertId} and resolved_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function listChannels(tx: Sql, orgId: string): Promise<NotificationChannelRow[]> {
  return tx<NotificationChannelRow[]>`
    select * from app.notification_channel where org_id = ${orgId} order by created_at
  `;
}

export async function createChannel(
  tx: Sql,
  orgId: string,
  input: { kind: ChannelKind; label: string; config?: JsonObject; secret?: Buffer | null },
): Promise<NotificationChannelRow> {
  const rows = await tx<NotificationChannelRow[]>`
    insert into app.notification_channel (org_id, kind, label, config, secret)
    values (${orgId}, ${input.kind}, ${input.label}, ${tx.json(input.config ?? {})}, ${input.secret ?? null})
    returning *
  `;
  const created = rows[0];
  if (!created) throw new Error("Notification channel insert returned no row");
  return created;
}

export async function deleteChannel(tx: Sql, channelId: string): Promise<void> {
  await tx`delete from app.notification_channel where id = ${channelId}`;
}

/** Latest check per monitor, for the status column in the interface. */
export async function latestChecks(
  tx: Sql,
  orgId: string,
): Promise<Array<{ monitor_id: string; status: CheckStatus; checked_at: Date; payload: JsonObject }>> {
  return tx<Array<{ monitor_id: string; status: CheckStatus; checked_at: Date; payload: JsonObject }>>`
    select distinct on (monitor_id) monitor_id, status, checked_at, payload
    from app.check_result
    where org_id = ${orgId}
    order by monitor_id, checked_at desc
  `;
}
