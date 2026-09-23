import { test } from "node:test";
import assert from "node:assert/strict";
import type { RenewalSubject } from "../src/renewal.ts";
import { evaluateRenewal, evaluateRenewals, renewalStage } from "../src/renewal.ts";

const NOW = new Date("2026-09-23T10:00:00Z");

function subject(over: Partial<RenewalSubject> = {}): RenewalSubject {
  return {
    source: "cost_line",
    id: "line-1",
    orgId: "org-1",
    assetId: "asset-1",
    assetLabel: "testbakery.com",
    clientName: "Test Bakery",
    dueOn: "2026-10-05",
    amountText: "USD 12.00 per year",
    charged: true,
    ...over,
  };
}

test("stages fall at 30, 14 and 3 days, and after the date", () => {
  assert.equal(renewalStage(31), null);
  assert.equal(renewalStage(30), "due_30");
  assert.equal(renewalStage(15), "due_30");
  assert.equal(renewalStage(14), "due_14");
  assert.equal(renewalStage(4), "due_14");
  assert.equal(renewalStage(3), "due_3");
  assert.equal(renewalStage(0), "due_3");
  assert.equal(renewalStage(-1), "overdue");
});

test("a cost line 12 days out raises a warning with the amount", () => {
  const alert = evaluateRenewal(subject(), NOW);
  assert.equal(alert?.rule, "renewal_due_14");
  assert.equal(alert?.severity, "warning");
  assert.equal(alert?.dedupeKey, "renewal:cost_line:line-1:2026-10-05:due_14");
  assert.equal(alert?.message, "testbakery.com renews in 12 days, on 2026-10-05 (USD 12.00 per year).");
});

test("three days out is critical, and an uncharged line says so", () => {
  const alert = evaluateRenewal(subject({ dueOn: "2026-09-24", charged: false }), NOW);
  assert.equal(alert?.severity, "critical");
  assert.match(alert?.message ?? "", /renews tomorrow/);
  assert.match(alert?.message ?? "", /The client is not charged for it\./);
});

test("a date from the database behaves like a string from a form", () => {
  const fromDb = evaluateRenewal(subject({ dueOn: new Date("2026-10-05T00:00:00Z") }), NOW);
  assert.equal(fromDb?.dedupeKey, evaluateRenewal(subject(), NOW)?.dedupeKey);
});

test("a passed date asks for the date to be moved on", () => {
  const alert = evaluateRenewal(subject({ dueOn: "2026-09-20" }), NOW);
  assert.equal(alert?.rule, "renewal_overdue");
  assert.match(alert?.message ?? "", /3 days ago/);
  assert.match(alert?.message ?? "", /move the date on/);
});

test("asset dates are worded as renew or expire", () => {
  const alert = evaluateRenewal(
    subject({ source: "asset", id: "asset-1", assetLabel: "Theme licence", amountText: null, dueOn: "2026-10-23" }),
    NOW,
  );
  assert.equal(alert?.rule, "renewal_due_30");
  assert.equal(alert?.message, "Theme licence is due to renew or expire in 30 days, on 2026-10-23.");
});

test("far-off and missing dates raise nothing", () => {
  assert.equal(evaluateRenewal(subject({ dueOn: "2026-12-01" }), NOW), null);
  assert.equal(evaluateRenewal(subject({ dueOn: null }), NOW), null);
  assert.equal(evaluateRenewals([subject({ dueOn: null }), subject()], NOW).length, 1);
});

test("moving the date changes the key, so the old reminder can be retired", () => {
  const before = evaluateRenewal(subject({ dueOn: "2026-09-25" }), NOW);
  const after = evaluateRenewal(subject({ dueOn: "2026-10-05" }), NOW);
  assert.notEqual(before?.dedupeKey, after?.dedupeKey);
});
