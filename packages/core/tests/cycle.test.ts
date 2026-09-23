import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cycleLabel, daysBetween, isBillingCycle, isRecurring, monthlyExact,
  monthsPerCycle, nextRenewalAfter, toMajorUnits, yearlyExact,
} from "../src/cycle.ts";
import { money } from "../src/money.ts";

test("recognises valid cycles", () => {
  assert.ok(isBillingCycle("annual"));
  assert.ok(!isBillingCycle("fortnightly"));
});

test("a one-off payment is not a monthly rate", () => {
  assert.equal(monthsPerCycle("once"), null);
  assert.equal(isRecurring("once"), false);
  assert.equal(monthlyExact(money(50_000, "USD"), "once"), 0);
});

test("normalises every cycle to a monthly figure", () => {
  assert.equal(monthlyExact(money(1200, "USD"), "annual"), 100);
  assert.equal(monthlyExact(money(1200, "USD"), "monthly"), 1200);
  assert.equal(monthlyExact(money(300, "USD"), "quarterly"), 100);
  assert.equal(monthlyExact(money(600, "USD"), "semiannual"), 100);
  assert.equal(monthlyExact(money(2400, "USD"), "biennial"), 100);
  assert.equal(monthlyExact(money(3600, "USD"), "triennial"), 100);
});

test("keeps division fractional so totals round only once", () => {
  // Three domains at 10.00 a year each: 1000/12 is not a whole number of cents.
  const each = monthlyExact(money(1000, "USD"), "annual");
  assert.ok(!Number.isInteger(each));
  // Summing exactly and rounding once gives 250, where rounding each row
  // first would give 3 * 83 = 249.
  assert.equal(Math.round(each * 3), 250);
});

test("yearly is twelve times monthly", () => {
  assert.equal(yearlyExact(money(1200, "USD"), "annual"), 1200);
});

test("finds the next renewal after a date", () => {
  const previous = new Date("2026-01-15T00:00:00Z");
  const next = nextRenewalAfter(previous, "annual", new Date("2026-09-20T00:00:00Z"));
  assert.equal(next?.toISOString().slice(0, 10), "2027-01-15");

  const monthly = nextRenewalAfter(previous, "monthly", new Date("2026-09-20T00:00:00Z"));
  assert.equal(monthly?.toISOString().slice(0, 10), "2026-10-15");

  assert.equal(nextRenewalAfter(previous, "once", new Date()), null);
});

test("clamps the day of month rather than rolling into the next month", () => {
  const jan31 = new Date("2026-01-31T00:00:00Z");
  const next = nextRenewalAfter(jan31, "monthly", new Date("2026-02-01T00:00:00Z"));
  assert.equal(next?.toISOString().slice(0, 10), "2026-02-28");
});

test("counts whole days in UTC", () => {
  assert.equal(daysBetween(new Date("2026-09-20T23:00:00Z"), new Date("2026-09-21T01:00:00Z")), 1);
  assert.equal(daysBetween(new Date("2026-09-20T00:00:00Z"), new Date("2026-09-20T23:59:00Z")), 0);
});

test("converts minor units to major for display", () => {
  assert.equal(toMajorUnits(money(1234, "USD")), 12.34);
  assert.equal(toMajorUnits(money(1234, "JPY")), 1234);
});

test("labels each cycle", () => {
  assert.equal(cycleLabel("annual"), "per year");
  assert.equal(cycleLabel("once"), "one-off");
});
