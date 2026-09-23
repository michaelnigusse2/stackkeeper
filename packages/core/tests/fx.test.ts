import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, convertExact, FxError, RateTable } from "../src/fx.ts";
import { money } from "../src/money.ts";

const rates = new RateTable([
  { base: "USD", quote: "EUR", rate: 0.9, asOf: "2026-09-20" },
  { base: "USD", quote: "ETB", rate: 150, asOf: "2026-09-20" },
  { base: "USD", quote: "JPY", rate: 150, asOf: "2026-09-20" },
]);

test("an identical pair converts one to one", () => {
  assert.equal(rates.rate("USD", "USD"), 1);
  assert.equal(convertExact(1234, "USD", "USD", rates), 1234);
});

test("uses the inverse when only one direction is stored", () => {
  assert.equal(rates.rate("EUR", "USD"), 1 / 0.9);
  assert.ok(rates.has("ETB", "USD"));
});

test("converts between two-decimal currencies", () => {
  // 10.00 USD at 0.90 is 9.00 EUR
  assert.equal(convert(money(1000, "USD"), "EUR", rates), 900);
});

test("respects differing minor units", () => {
  // 10.00 USD at 150 is 1500 yen, which has no minor unit
  assert.equal(convert(money(1000, "USD"), "JPY", rates), 1500);
  // and back again
  assert.equal(Math.round(convert(money(1500, "JPY"), "USD", rates)), 1000);
});

test("refuses to invent a cross rate", () => {
  assert.equal(rates.rate("EUR", "ETB"), undefined);
  assert.throws(() => convertExact(100, "EUR", "ETB", rates), FxError);
});

test("names both currencies when no rate exists", () => {
  assert.throws(
    () => convertExact(100, "EUR", "GBP", rates),
    /No exchange rate from EUR to GBP/,
  );
});
