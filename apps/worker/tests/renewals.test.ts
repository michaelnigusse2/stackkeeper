import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlertEventRow, RenewalAssetRow, RenewalCostLineRow } from "@stackkeeper/db";
import { describeCost, renewalAlerts } from "../src/renewals.ts";
import { formatAlert } from "../src/notify.ts";

const NOW = new Date("2026-09-23T10:00:00Z");

function line(over: Partial<RenewalCostLineRow> = {}): RenewalCostLineRow {
  return {
    id: "line-1",
    org_id: "org-1",
    asset_id: "asset-1",
    asset_label: "testbakery.com",
    client_name: "Test Bakery",
    // Postgres returns a date column as a Date and a bigint as a string.
    next_renewal: new Date("2026-10-05T00:00:00Z"),
    cost_amount: "1200",
    cost_currency: "USD",
    cost_cycle: "annual",
    charged: false,
    ...over,
  };
}

function asset(over: Partial<RenewalAssetRow> = {}): RenewalAssetRow {
  return {
    id: "asset-2",
    org_id: "org-1",
    label: "Theme licence",
    client_name: "Test Bakery",
    expires_at: new Date("2026-09-25T15:30:00Z"),
    ...over,
  };
}

test("describes a cost as the database stores it", () => {
  assert.equal(describeCost(line()), "USD 12.00 per year");
  assert.equal(describeCost(line({ cost_amount: "150000", cost_currency: "ETB", cost_cycle: "monthly" })), "ETB 1500.00 per month");
});

test("cost lines and assets both become reminders", () => {
  const alerts = renewalAlerts([line()], [asset()], NOW);
  assert.equal(alerts.length, 2);
  const [fromLine, fromAsset] = alerts;
  assert.equal(fromLine?.rule, "renewal_due_14");
  assert.equal(
    fromLine?.message,
    "testbakery.com renews in 12 days, on 2026-10-05 (USD 12.00 per year). The client is not charged for it.",
  );
  assert.equal(fromAsset?.rule, "renewal_due_3");
  assert.equal(fromAsset?.assetId, "asset-2");
});

test("a reminder is delivered without the monitor-only 'Checked' line", () => {
  const [reminder] = renewalAlerts([line()], [], NOW);
  const row: AlertEventRow = {
    id: "e1",
    org_id: "org-1",
    monitor_id: null,
    asset_id: "asset-1",
    severity: reminder?.severity ?? "warning",
    rule: reminder?.rule ?? "",
    dedupe_key: reminder?.dedupeKey ?? "",
    message: reminder?.message ?? "",
    data: {},
    opened_at: NOW,
    notified_at: null,
    resolved_at: null,
    needs_payment_confirmation: false,
  } as AlertEventRow;
  const formatted = formatAlert(row, {
    assetLabel: "testbakery.com",
    clientName: "Test Bakery",
    target: "",
    appUrl: "http://localhost:3000",
  });
  assert.equal(formatted.subject, "Heads up: testbakery.com for Test Bakery");
  assert.ok(!formatted.body.includes("Checked:"));
});
