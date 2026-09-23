import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAlert } from "../src/notify.ts";
import type { AlertEventRow } from "@stackkeeper/db";

function alert(over: Partial<AlertEventRow> = {}): AlertEventRow {
  return {
    id: "a1",
    org_id: "org_a",
    monitor_id: "m1",
    asset_id: "as1",
    severity: "critical",
    rule: "domain_expiry_7d",
    dedupe_key: "domain:example.com:domain_expiry_7d",
    message: "The registration expires in 6 day(s).",
    data: {},
    opened_at: new Date(),
    notified_at: null,
    resolved_at: null,
    needs_payment_confirmation: false,
    ...over,
  };
}

const CONTEXT = {
  assetLabel: "acmebakery.com",
  clientName: "Acme Bakery",
  target: "acmebakery.com",
  appUrl: "https://stackkeeper.example/",
};

test("names the client and the asset in the subject", () => {
  const formatted = formatAlert(alert(), CONTEXT);
  assert.equal(formatted.subject, "Action needed: acmebakery.com for Acme Bakery");
  assert.match(formatted.body, /expires in 6 day/);
});

test("softens the lead for a warning", () => {
  assert.match(formatAlert(alert({ severity: "warning" }), CONTEXT).subject, /^Heads up:/);
  assert.match(formatAlert(alert({ severity: "info" }), CONTEXT).subject, /^For information:/);
});

test("explains the automatic renewal trap when that is what happened", () => {
  const formatted = formatAlert(alert({ needs_payment_confirmation: true }), CONTEXT);
  assert.match(formatted.body, /before anyone has paid/);
  assert.match(formatted.body, /Check with the registrar/);
});

test("says nothing about renewals when it is not relevant", () => {
  assert.ok(!formatAlert(alert(), CONTEXT).body.includes("registrar"));
});

test("copes with an alert that has no client or asset name", () => {
  const formatted = formatAlert(alert(), {
    ...CONTEXT,
    assetLabel: null,
    clientName: null,
  });
  assert.equal(formatted.subject, "Action needed: acmebakery.com");
});

test("builds a link without doubling the slash", () => {
  assert.equal(formatAlert(alert(), CONTEXT).url, "https://stackkeeper.example/alerts");
  assert.equal(
    formatAlert(alert(), { ...CONTEXT, appUrl: "https://x.example" }).url,
    "https://x.example/alerts",
  );
});
