/**
 * Turning the dates users enter into renewal reminders.
 *
 * The database rows are shaped here and the decision is made in
 * `@stackkeeper/core`, so both halves can be tested without a database.
 */

import { cycleLabel, evaluateRenewals, formatAmount, money } from "@stackkeeper/core";
import type { RenewalAlert, RenewalSubject } from "@stackkeeper/core";
import { toMinorUnits, type RenewalAssetRow, type RenewalCostLineRow } from "@stackkeeper/db";

/** "USD 12.00 per year", or null if the stored amount cannot be read. */
export function describeCost(row: RenewalCostLineRow): string | null {
  try {
    const amount = toMinorUnits(row.cost_amount);
    if (amount === null) return null;
    const value = formatAmount(money(amount, row.cost_currency));
    return `${row.cost_currency} ${value} ${cycleLabel(row.cost_cycle)}`;
  } catch {
    return null;
  }
}

export function renewalSubjects(
  lines: readonly RenewalCostLineRow[],
  assets: readonly RenewalAssetRow[],
): RenewalSubject[] {
  return [
    ...lines.map(
      (row): RenewalSubject => ({
        source: "cost_line",
        id: row.id,
        orgId: row.org_id,
        assetId: row.asset_id,
        assetLabel: row.asset_label,
        clientName: row.client_name,
        dueOn: row.next_renewal,
        amountText: describeCost(row),
        charged: row.charged,
      }),
    ),
    ...assets.map(
      (row): RenewalSubject => ({
        source: "asset",
        id: row.id,
        orgId: row.org_id,
        assetId: row.id,
        assetLabel: row.label,
        clientName: row.client_name,
        dueOn: row.expires_at,
      }),
    ),
  ];
}

export function renewalAlerts(
  lines: readonly RenewalCostLineRow[],
  assets: readonly RenewalAssetRow[],
  now: Date = new Date(),
): RenewalAlert[] {
  return evaluateRenewals(renewalSubjects(lines, assets), now);
}
