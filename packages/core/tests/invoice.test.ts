import { test } from "node:test";
import assert from "node:assert/strict";
import type { InvoiceLineInput } from "../src/invoice.ts";
import { dueDayInMonth, invoiceCsv, invoiceSummary, parseMonth } from "../src/invoice.ts";

function line(over: Partial<InvoiceLineInput> = {}): InvoiceLineInput {
  return {
    lineId: "line-1",
    clientName: "Test Bakery",
    assetLabel: "testbakery.com",
    provider: "Namecheap",
    costAmount: 1200,
    costCurrency: "USD",
    costCycle: "annual",
    chargeAmount: 2500,
    chargeCurrency: "USD",
    chargeCycle: "monthly",
    billed: true,
    ...over,
  };
}

test("parseMonth gives the first and last day, including leap February", () => {
  assert.deepEqual(parseMonth("2028-02"), { year: 2028, month: 2, first: "2028-02-01", last: "2028-02-29" });
  assert.equal(parseMonth("2026-09").last, "2026-09-30");
  assert.throws(() => parseMonth("2026-13"));
  assert.throws(() => parseMonth("October"));
});

test("a monthly charge is due every month it is active", () => {
  const [row] = invoiceSummary([line()], "2026-10");
  assert.equal(row?.status, "due");
  assert.equal(row?.amount, "25.00");
  assert.equal(row?.currency, "USD");
  assert.equal(row?.dueOn, null);
});

test("an annual charge is due only in the month of its renewal", () => {
  const annual = line({ chargeCycle: "annual", nextRenewal: "2027-03-14" });
  assert.equal(invoiceSummary([annual], "2026-10").length, 0);
  const [row] = invoiceSummary([annual], "2027-03");
  assert.equal(row?.dueOn, "2027-03-14");
  // A year earlier lines up too, stepping back by the cycle.
  assert.equal(invoiceSummary([annual], "2026-03")[0]?.dueOn, "2026-03-14");
});

test("a quarterly charge steps by three months from its renewal date", () => {
  const quarterly = line({ chargeCycle: "quarterly", nextRenewal: new Date("2026-11-30T00:00:00Z") });
  assert.equal(invoiceSummary([quarterly], "2026-11")[0]?.dueOn, "2026-11-30");
  assert.equal(invoiceSummary([quarterly], "2026-12").length, 0);
  // 30 Nov plus three months is clamped to the end of February.
  assert.equal(invoiceSummary([quarterly], "2027-02")[0]?.dueOn, "2027-02-28");
  assert.equal(invoiceSummary([quarterly], "2026-08")[0]?.dueOn, "2026-08-30");
});

test("a longer cycle with no renewal date is listed, not dropped", () => {
  const [row] = invoiceSummary([line({ chargeCycle: "annual", nextRenewal: null })], "2026-10");
  assert.equal(row?.status, "due_date_unknown");
});

test("a cost with no charge is listed as not charged, in the cost currency", () => {
  const [row] = invoiceSummary(
    [line({ chargeAmount: null, chargeCurrency: null, chargeCycle: null, costCurrency: "EUR" })],
    "2026-10",
  );
  assert.equal(row?.status, "not_charged");
  assert.equal(row?.amount, "12.00");
  assert.equal(row?.currency, "EUR");
});

test("lines that ended before, or start after, the month are left out", () => {
  assert.equal(invoiceSummary([line({ endedOn: "2026-09-30" })], "2026-10").length, 0);
  assert.equal(invoiceSummary([line({ startedOn: "2026-11-01" })], "2026-10").length, 0);
  // A Date from the database behaves the same as a string from a form.
  assert.equal(invoiceSummary([line({ endedOn: new Date("2026-09-30T00:00:00Z") })], "2026-10").length, 0);
  assert.equal(invoiceSummary([line({ endedOn: "2026-10-15" })], "2026-10").length, 1);
});

test("a renewal that falls after the line ended is not due", () => {
  const annual = line({ chargeCycle: "annual", nextRenewal: "2026-10-20", endedOn: "2026-10-10" });
  assert.equal(invoiceSummary([annual], "2026-10").length, 0);
});

test("one-off charges are due in the month they started", () => {
  const setup = line({ chargeCycle: "once", startedOn: "2026-10-05", billed: false });
  assert.equal(invoiceSummary([setup], "2026-10")[0]?.dueOn, "2026-10-05");
  assert.equal(invoiceSummary([setup], "2026-11").length, 0);
  const undated = line({ chargeCycle: "once", startedOn: null, billed: false });
  assert.equal(invoiceSummary([undated], "2026-10")[0]?.status, "due_date_unknown");
  assert.equal(invoiceSummary([{ ...undated, billed: true }], "2026-10").length, 0);
});

test("rows are grouped by client, due items first", () => {
  const rows = invoiceSummary(
    [
      line({ lineId: "a", clientName: "Zeta", assetLabel: "z.com" }),
      line({ lineId: "b", clientName: "Alpha", assetLabel: "b.com", chargeAmount: null, chargeCurrency: null, chargeCycle: null }),
      line({ lineId: "c", clientName: "Alpha", assetLabel: "c.com" }),
    ],
    "2026-10",
  );
  assert.deepEqual(rows.map((r) => r.lineId), ["c", "b", "a"]);
});

test("dueDayInMonth handles anchors in later years", () => {
  assert.equal(dueDayInMonth("2027-10-01", 12, parseMonth("2026-10")), "2026-10-01");
  assert.equal(dueDayInMonth("2027-10-01", 24, parseMonth("2026-10")), null);
});

test("CSV quotes, neutralises formulas and starts with a byte-order mark", () => {
  const csv = invoiceCsv(
    invoiceSummary([line({ clientName: "=HYPERLINK(\"x\")", assetLabel: "a, b", note: "line\nbreak" })], "2026-10"),
  );
  assert.ok(csv.startsWith("﻿Client,Asset,"));
  const body = csv.split("\r\n")[1] ?? "";
  assert.ok(body.startsWith(`"'=HYPERLINK(""x"")","a, b",`));
  assert.ok(csv.includes('"line\nbreak"'));
  assert.ok(csv.endsWith("\r\n"));
});
