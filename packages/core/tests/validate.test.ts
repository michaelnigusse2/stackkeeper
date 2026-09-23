import { test } from "node:test";
import assert from "node:assert/strict";
import { FormReader, isEmail, isHttpUrl, isIsoDate, isUuid } from "../src/validate.ts";

function reader(pairs: Record<string, string>): FormReader {
  return new FormReader(Object.entries(pairs));
}

test("requires text and reports a readable message", () => {
  const r = reader({ name: "  " });
  r.requiredText("name", "Client name");
  assert.equal(r.valid, false);
  assert.equal(r.errors.name, "Client name is required.");
});

test("collects every error rather than stopping at the first", () => {
  const r = reader({ name: "", email: "nope" });
  r.requiredText("name", "Name");
  r.email("email", "Email");
  assert.deepEqual(Object.keys(r.errors).sort(), ["email", "name"]);
});

test("trims values and treats blank optional fields as null", () => {
  const r = reader({ notes: "  hello  ", blank: "   " });
  assert.equal(r.optionalText("notes", "Notes"), "hello");
  assert.equal(r.optionalText("blank", "Blank"), null);
  assert.ok(r.valid);
});

test("enforces a maximum length", () => {
  const r = reader({ name: "x".repeat(300) });
  r.requiredText("name", "Name", { max: 200 });
  assert.match(r.errors.name!, /200 characters or fewer/);
});

test("falls back for an empty choice and rejects an unknown one", () => {
  const allowed = ["active", "paused"] as const;
  const empty = reader({});
  assert.equal(empty.choice("status", "Status", allowed, "active"), "active");
  assert.ok(empty.valid);

  const bad = reader({ status: "exploded" });
  bad.choice("status", "Status", allowed, "active");
  assert.equal(bad.valid, false);
});

test("reads checkbox values", () => {
  assert.equal(reader({ billed: "on" }).boolean("billed"), true);
  assert.equal(reader({ billed: "true" }).boolean("billed"), true);
  assert.equal(reader({}).boolean("billed"), false);
});

test("parses money in the right currency and rejects nonsense", () => {
  const good = reader({ cost: "12.34" });
  assert.equal(good.money("cost", "Cost", "USD")?.amount, 1234);

  const yen = reader({ cost: "1200" });
  assert.equal(yen.money("cost", "Cost", "JPY")?.amount, 1200);

  const tooPrecise = reader({ cost: "12.345" });
  tooPrecise.money("cost", "Cost", "USD");
  assert.equal(tooPrecise.valid, false);

  const negative = reader({ cost: "-5.00" });
  negative.money("cost", "Cost", "USD");
  assert.match(negative.errors.cost!, /cannot be negative/);
});

test("validates currencies, cycles, dates, urls and identifiers", () => {
  const r = reader({
    currency: "etb",
    cycle: "annual",
    date: "2026-09-20",
    url: "https://example.com",
    id: "9f1c0b3e-4a2d-4f8b-9c31-7d4e5f6a8b90",
  });
  assert.equal(r.currency("currency", "Currency", "USD"), "ETB");
  assert.equal(r.cycle("cycle", "Cycle", "monthly"), "annual");
  assert.equal(r.date("date", "Date"), "2026-09-20");
  assert.equal(r.url("url", "URL"), "https://example.com");
  assert.equal(r.uuid("id", "Identifier"), "9f1c0b3e-4a2d-4f8b-9c31-7d4e5f6a8b90");
  assert.ok(r.valid);
});

test("rejects impossible dates and non-http urls", () => {
  assert.ok(!isIsoDate("2026-02-30"));
  assert.ok(!isIsoDate("20-09-2026"));
  assert.ok(isIsoDate("2028-02-29"));
  assert.ok(!isHttpUrl("javascript:alert(1)"));
  assert.ok(!isHttpUrl("example.com"));
  assert.ok(isHttpUrl("http://example.com"));
});

test("recognises addresses and identifiers", () => {
  assert.ok(isEmail("a@b.co"));
  assert.ok(!isEmail("a@b"));
  assert.ok(!isEmail("no-at-sign.com"));
  assert.ok(isUuid("9f1c0b3e-4a2d-4f8b-9c31-7d4e5f6a8b90"));
  assert.ok(!isUuid("not-a-uuid"));
});

test("hands back a typed result only when everything parsed", () => {
  const good = reader({ name: "Acme" });
  const name = good.requiredText("name", "Name");
  assert.deepEqual(good.result({ name }), { ok: true, value: { name: "Acme" } });

  const bad = reader({});
  bad.requiredText("name", "Name");
  const out = bad.result({ name: "" });
  assert.equal(out.ok, false);
});
