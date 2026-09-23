import type { BillingCycle } from "@stackkeeper/core";
import type { Sql } from "../sql.ts";
import type { AlertSeverity } from "./monitors.ts";

/**
 * Renewal reminders: the dates only the user knows.
 *
 * Every function here takes `ownerTx`, the worker's connection, which migration
 * 0004 lets read across organisations through a named policy.
 */

export interface RenewalCostLineRow {
  id: string;
  org_id: string;
  asset_id: string;
  asset_label: string;
  client_name: string;
  next_renewal: Date | string;
  cost_amount: string | number;
  cost_currency: string;
  cost_cycle: BillingCycle;
  charged: boolean;
}

export interface RenewalAssetRow {
  id: string;
  org_id: string;
  label: string;
  client_name: string;
  expires_at: Date | string;
}

/**
 * Cost lines whose next renewal is within `withinDays`, or passed in the last
 * `overdueDays`. Lines that have ended, and deleted assets and clients, are
 * left out. Older overdue dates are left alone rather than raised all at once
 * the first time the worker runs against a database full of stale dates.
 */
export async function upcomingCostLineRenewals(
  ownerTx: Sql,
  withinDays = 30,
  overdueDays = 60,
): Promise<RenewalCostLineRow[]> {
  return ownerTx<RenewalCostLineRow[]>`
    select cl.id, cl.org_id, cl.asset_id, a.label as asset_label, c.name as client_name,
           cl.next_renewal, cl.cost_amount, cl.cost_currency, cl.cost_cycle,
           (cl.charge_amount is not null) as charged
    from app.cost_line cl
    join app.asset a on a.org_id = cl.org_id and a.id = cl.asset_id
    join app.client c on c.org_id = a.org_id and c.id = a.client_id
    where cl.next_renewal is not null
      and cl.next_renewal <= current_date + ${withinDays}::int
      and cl.next_renewal >= current_date - ${overdueDays}::int
      and (cl.ended_on is null or cl.ended_on >= current_date)
      and a.deleted_at is null
      and c.deleted_at is null
  `;
}

/**
 * Assets with a renewal or expiry date of their own and nothing watching it.
 * A domain or certificate with an enabled monitor is skipped: the monitor
 * already alerts on its expiry, from the registry's own data.
 */
export async function upcomingAssetRenewals(
  ownerTx: Sql,
  withinDays = 30,
  overdueDays = 60,
): Promise<RenewalAssetRow[]> {
  return ownerTx<RenewalAssetRow[]>`
    select a.id, a.org_id, a.label, c.name as client_name, a.expires_at
    from app.asset a
    join app.client c on c.org_id = a.org_id and c.id = a.client_id
    where a.expires_at is not null
      and a.expires_at <= now() + make_interval(days => ${withinDays})
      and a.expires_at >= now() - make_interval(days => ${overdueDays})
      and a.deleted_at is null
      and c.deleted_at is null
      and not exists (
        select 1 from app.monitor m
        where m.org_id = a.org_id and m.asset_id = a.id and m.enabled
      )
  `;
}

/**
 * Open a renewal reminder unless one with the same key has ever existed.
 * The key carries the date and the stage, so a reminder someone acknowledged
 * stays acknowledged until the next stage, instead of reopening every hour.
 */
export async function openRenewalAlert(
  ownerTx: Sql,
  input: {
    orgId: string;
    assetId: string;
    severity: AlertSeverity;
    rule: string;
    dedupeKey: string;
    message: string;
    dueOn: string;
    source: string;
    sourceId: string;
  },
): Promise<boolean> {
  const rows = await ownerTx`
    insert into app.alert_event (org_id, monitor_id, asset_id, severity, rule, dedupe_key, message, data)
    select ${input.orgId}, null, ${input.assetId}, ${input.severity}, ${input.rule},
           ${input.dedupeKey}, ${input.message},
           ${ownerTx.json({ dueOn: input.dueOn, source: input.source, sourceId: input.sourceId })}
    where not exists (
      select 1 from app.alert_event e
      where e.org_id = ${input.orgId} and e.dedupe_key = ${input.dedupeKey}
    )
    on conflict do nothing
    returning id
  `;
  return rows.length > 0;
}

/**
 * Close open renewal reminders that no longer apply: the date moved on, the
 * next stage took over, or the line ended or was deleted.
 */
export async function resolveStaleRenewalAlerts(
  ownerTx: Sql,
  currentKeys: readonly string[],
): Promise<number> {
  const rows = await ownerTx`
    update app.alert_event set resolved_at = now()
    where resolved_at is null
      and monitor_id is null
      and dedupe_key like 'renewal:%'
      and not (dedupe_key = any(${currentKeys as string[]}::text[]))
    returning id
  `;
  return rows.length;
}
