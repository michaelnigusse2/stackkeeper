import { test } from "node:test";
import assert from "node:assert/strict";
import { RateTable } from "../src/fx.ts";
import type { CostLineLike } from "../src/margin.ts";
import { isLineActive, leakage, lineMargin, rollUpMargin, unbilledLines } from "../src/margin.ts";

const rates = new RateTable([
  { base: "USD", quote: "EUR", rate: 0.9, asOf: "2026-09-20" },
]);

function line(over: Partial<CostLineLike> = {}): CostLineLike {
  return {
    id: "line-1",
    assetId: "asset-1",
    costAmount: 1200,
    costCurrency: "USD",
    costCycle: "annual",
    chargeAmount: 2400,
    chargeCurrency: "USD",
    chargeCycle: "annual",
    billed: true,
    ...over,
  };
}

test("computes a monthly margin from annual figures", () => {
  const result = lineMargin(line(), "USD", rates);
  assert.equal(result.monthlyCost.amount, 100);
  assert.equal(result.monthlyCharge.amount, 200);
  assert.equal(result.monthlyMargin.amount, 100);
  assert.equal(result.marginRatio, 0.5);
  assert.deepEqual(result.flags, []);
});

test("flags a service that is paid for but never charged", () => {
  const result = lineMargin(
    line({ chargeAmount: null, chargeCurrency: null, chargeCycle: null }),
    "USD",
    rates,
  );
  assert.equal(result.monthlyMargin.amount, -100);
  assert.ok(result.flags.some((f) => f.code === "no_charge" && f.severity === "critical"));
});

test("flags a charge that has not been invoiced", () => {
  const result = lineMargin(line({ billed: false }), "USD", rates);
  assert.ok(result.flags.some((f) => f.code === "not_invoiced"));
});

test("flags a charge below cost", () => {
  const result = lineMargin(line({ chargeAmount: 600 }), "USD", rates);
  assert.ok(result.flags.some((f) => f.code === "below_cost"));
  assert.equal(result.monthlyMargin.amount, -50);
});

test("flags a pass-through at cost without calling it a loss", () => {
  const result = lineMargin(line({ chargeAmount: 1200 }), "USD", rates);
  assert.ok(result.flags.some((f) => f.code === "charge_equals_cost"));
  assert.ok(!result.flags.some((f) => f.code === "below_cost"));
  assert.equal(result.monthlyMargin.amount, 0);
});

test("converts into the reporting currency", () => {
  const result = lineMargin(line(), "EUR", rates);
  assert.equal(result.monthlyCost.amount, 90);
  assert.equal(result.monthlyCharge.amount, 180);
});

test("a line with no available rate is excluded, never counted as zero", () => {
  const result = lineMargin(line({ costCurrency: "GBP" }), "EUR", rates);
  assert.equal(result.counted, false);
  assert.ok(result.flags.some((f) => f.code === "missing_rate"));

  const rollup = rollUpMargin([line(), line({ id: "line-2", costCurrency: "GBP" })], "EUR", rates);
  assert.ok(rollup.incomplete);
  assert.deepEqual(rollup.uncountedLineIds, ["line-2"]);
  // Only the convertible line is in the total.
  assert.equal(rollup.monthlyCost.amount, 90);
});

test("rolls up many lines, rounding once at the end", () => {
  // Three domains at 10.00 a year: 1000/12 each. Rounding per row would give
  // 3 x 83 = 249. Rounding the exact sum gives 250.
  const lines = [1, 2, 3].map((n) =>
    line({
      id: `line-${n}`,
      costAmount: 1000,
      costCycle: "annual",
      chargeAmount: null,
      chargeCurrency: null,
      chargeCycle: null,
    }),
  );
  const rollup = rollUpMargin(lines, "USD", rates);
  assert.equal(rollup.monthlyCost.amount, 250);
  assert.equal(rollup.monthlyCharge.amount, 0);
  assert.equal(rollup.monthlyMargin.amount, -250);
  assert.equal(rollup.yearlyMargin.amount, -3000);
  assert.equal(rollup.flagCounts.no_charge, 3);
});

test("ignores lines that have ended or have not started", () => {
  const asOf = new Date("2026-09-20T00:00:00Z");
  assert.equal(isLineActive(line({ endedOn: "2026-08-01" }), asOf), false);
  assert.equal(isLineActive(line({ startedOn: "2026-10-01" }), asOf), false);
  assert.equal(isLineActive(line({ startedOn: "2026-01-01", endedOn: "2027-01-01" }), asOf), true);

  const rollup = rollUpMargin(
    [line(), line({ id: "old", endedOn: "2026-08-01" })],
    "USD",
    rates,
    asOf,
  );
  assert.equal(rollup.lines.length, 1);
});

test("ranks the worst leaks first and totals what is leaking", () => {
  const rollup = rollUpMargin(
    [
      line({ id: "ok" }),
      line({ id: "free", chargeAmount: null, chargeCurrency: null, chargeCycle: null }),
      line({ id: "cheap", costAmount: 12000, chargeAmount: 1200 }),
    ],
    "USD",
    rates,
  );

  const worst = unbilledLines(rollup);
  assert.equal(worst[0]!.lineId, "cheap");
  assert.equal(worst.length, 2);

  // 900 a month under-charged plus 100 a month unbilled.
  assert.equal(leakage(rollup).amount, 1000);
});

test("a one-off cost does not distort the monthly run rate", () => {
  const rollup = rollUpMargin(
    [line({ costAmount: 50_000, costCycle: "once", chargeAmount: null, chargeCurrency: null, chargeCycle: null })],
    "USD",
    rates,
  );
  assert.equal(rollup.monthlyCost.amount, 0);
});

test("a date from the database is handled whichever shape it arrives in", () => {
  const asOf = new Date("2026-09-21T00:00:00Z");

  // A Postgres `date` column arrives as a Date, not a string. Comparing the
  // two shapes with `<` quietly returns false for every row, so a cancelled
  // service would have gone on counting toward margin for ever.
  assert.equal(isLineActive(line({ endedOn: new Date("2026-01-01T00:00:00Z") }), asOf), false);
  assert.equal(isLineActive(line({ endedOn: "2026-01-01" }), asOf), false);

  assert.equal(isLineActive(line({ startedOn: new Date("2027-01-01T00:00:00Z") }), asOf), false);
  assert.equal(isLineActive(line({ startedOn: "2027-01-01" }), asOf), false);

  assert.equal(isLineActive(line({ startedOn: new Date("2026-01-01T00:00:00Z") }), asOf), true);
  assert.equal(isLineActive(line({ endedOn: new Date("2027-01-01T00:00:00Z") }), asOf), true);
});

test("an unreadable date is treated as no limit rather than excluding the row", () => {
  const asOf = new Date("2026-09-21T00:00:00Z");
  assert.equal(isLineActive(line({ endedOn: "" }), asOf), true);
  assert.equal(isLineActive(line({ endedOn: new Date("nonsense") }), asOf), true);
  assert.equal(isLineActive(line({ endedOn: null }), asOf), true);
});

test("a cancelled line is left out of the totals whichever shape its date is", () => {
  const asOf = new Date("2026-09-21T00:00:00Z");
  const rollup = rollUpMargin(
    [line({ id: "live" }), line({ id: "cancelled", endedOn: new Date("2026-01-01T00:00:00Z") })],
    "USD",
    rates,
    asOf,
  );
  assert.equal(rollup.lines.length, 1);
  assert.equal(rollup.lines[0]!.lineId, "live");
});
