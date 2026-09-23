import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { isReportToken } from "../src/report-token.ts";

test("a freshly generated token is accepted", () => {
  for (let i = 0; i < 50; i++) assert.ok(isReportToken(randomBytes(32).toString("base64url")));
});

test("anything else is rejected before a lookup", () => {
  assert.equal(isReportToken(""), false);
  assert.equal(isReportToken("a".repeat(42)), false);
  assert.equal(isReportToken("a".repeat(44)), false);
  assert.equal(isReportToken(`${"a".repeat(42)}=`), false);
  assert.equal(isReportToken(`${"a".repeat(42)}/`), false);
  assert.equal(isReportToken("../../etc/passwd"), false);
  assert.equal(isReportToken(null), false);
});
