import { test } from "node:test";
import assert from "node:assert/strict";
import {
  add, compare, exponentOf, formatAmount, formatMoney, isZero, money,
  MoneyError, negate, parseAmount, subtract, toMoney, zero,
} from "../src/money.ts";

test("rejects fractional minor units", () => {
  assert.throws(() => money(10.5, "USD"), MoneyError);
});

test("rejects codes that are not ISO 4217", () => {
  assert.throws(() => money(100, "usd"), MoneyError);
  assert.throws(() => money(100, "DOLLAR"), MoneyError);
});

test("knows currencies without two decimal places", () => {
  assert.equal(exponentOf("USD"), 2);
  assert.equal(exponentOf("ETB"), 2);
  assert.equal(exponentOf("JPY"), 0);
  assert.equal(exponentOf("KWD"), 3);
});

test("refuses to mix currencies", () => {
  assert.throws(() => add(money(100, "USD"), money(100, "EUR")), MoneyError);
});

test("adds, subtracts and negates", () => {
  assert.deepEqual(add(money(100, "USD"), money(250, "USD")), money(350, "USD"));
  assert.deepEqual(subtract(money(100, "USD"), money(250, "USD")), money(-150, "USD"));
  assert.deepEqual(negate(money(100, "USD")), money(-100, "USD"));
  assert.ok(isZero(zero("USD")));
  assert.equal(compare(money(1, "USD"), money(2, "USD")), -1);
});

test("parses decimal input into minor units", () => {
  assert.equal(parseAmount("12.34", "USD").amount, 1234);
  assert.equal(parseAmount("12", "USD").amount, 1200);
  assert.equal(parseAmount("12.3", "USD").amount, 1230);
  assert.equal(parseAmount("1,234.56", "USD").amount, 123456);
  assert.equal(parseAmount("-5.00", "USD").amount, -500);
  assert.equal(parseAmount("1200", "JPY").amount, 1200);
  assert.equal(parseAmount("1.234", "KWD").amount, 1234);
});

test("rejects more decimal places than the currency has", () => {
  assert.throws(() => parseAmount("12.345", "USD"), MoneyError);
  assert.throws(() => parseAmount("12.5", "JPY"), MoneyError);
  assert.throws(() => parseAmount("abc", "USD"), MoneyError);
  assert.throws(() => parseAmount("", "USD"), MoneyError);
});

test("formats minor units back to a decimal string", () => {
  assert.equal(formatAmount(money(1234, "USD")), "12.34");
  assert.equal(formatAmount(money(5, "USD")), "0.05");
  assert.equal(formatAmount(money(-500, "USD")), "-5.00");
  assert.equal(formatAmount(money(1200, "JPY")), "1200");
  assert.equal(formatAmount(money(1234, "KWD")), "1.234");
});

test("round trips through parse and format", () => {
  for (const input of ["0.00", "0.01", "99.99", "1000.00", "-12.34"]) {
    assert.equal(formatAmount(parseAmount(input, "USD")), input);
  }
});

test("rounds ties away from zero, and never produces negative zero", () => {
  assert.equal(toMoney(10.5, "USD").amount, 11);
  assert.equal(toMoney(-10.5, "USD").amount, -11);
  assert.equal(toMoney(10.4, "USD").amount, 10);
  assert.equal(toMoney(-0.4, "USD").amount, 0);
  assert.ok(!Object.is(toMoney(-0.4, "USD").amount, -0));
});

test("formats for display with the right number of decimals", () => {
  assert.match(formatMoney(money(123456, "USD")), /1,234\.56/);
  assert.doesNotMatch(formatMoney(money(1200, "JPY")), /\./);
});
