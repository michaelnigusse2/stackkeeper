import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMapping, ASSET_IMPORT_FIELDS, CsvError, detectDelimiter,
  normaliseHeader, parseCsv, suggestMapping,
} from "../src/csv.ts";

test("parses a plain file", () => {
  const table = parseCsv("client,domain\nAcme,acme.com\nBorealis,borealis.io\n");
  assert.deepEqual(table.headers, ["client", "domain"]);
  assert.deepEqual(table.rows, [["Acme", "acme.com"], ["Borealis", "borealis.io"]]);
});

test("handles quoted fields with commas, quotes and newlines", () => {
  const table = parseCsv('a,b\n"Smith, John","He said ""hi"""\n"line one\nline two",x\n');
  assert.deepEqual(table.rows[0], ["Smith, John", 'He said "hi"']);
  assert.deepEqual(table.rows[1], ["line one\nline two", "x"]);
});

test("copes with a byte order mark and carriage returns", () => {
  const table = parseCsv("﻿client,domain\r\nAcme,acme.com\r\n");
  assert.deepEqual(table.headers, ["client", "domain"]);
  assert.deepEqual(table.rows, [["Acme", "acme.com"]]);
});

test("detects semicolon and tab delimited files", () => {
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
  assert.deepEqual(parseCsv("client;domain\nAcme;acme.com").rows, [["Acme", "acme.com"]]);
});

test("does not split on a delimiter inside quotes when detecting", () => {
  assert.equal(detectDelimiter('"a;b;c;d",x\n'), ",");
});

test("drops blank lines but keeps empty cells", () => {
  const table = parseCsv("a,b\n1,\n\n2,3\n");
  assert.deepEqual(table.rows, [["1", ""], ["2", "3"]]);
});

test("refuses a file with no header", () => {
  assert.throws(() => parseCsv(""), CsvError);
});

test("reports an unterminated quote in words a user can act on", () => {
  assert.throws(() => parseCsv('a,b\n"unclosed,x\n'), /stray quotation mark/);
});

test("normalises headers for matching", () => {
  assert.equal(normaliseHeader("Renewal Date"), "renewaldate");
  assert.equal(normaliseHeader("cost_price "), "costprice");
});

test("suggests a mapping from real-world column names", () => {
  const headers = ["Customer", "Domain Name", "Registrar", "Renewal Date", "Cost", "Client Pays"];
  const mapping = suggestMapping(headers, ASSET_IMPORT_FIELDS);
  assert.equal(mapping.client, 0);
  assert.equal(mapping.provider, 2);
  assert.equal(mapping.expiresAt, 3);
  assert.equal(mapping.costAmount, 4);
  assert.equal(mapping.chargeAmount, 5);
});

test("never maps two fields to the same column", () => {
  const mapping = suggestMapping(["Domain", "Cost"], ASSET_IMPORT_FIELDS);
  const used = Object.values(mapping).filter((v): v is number => v !== null);
  assert.equal(new Set(used).size, used.length);
});

test("leaves a field unmapped when nothing matches", () => {
  const mapping = suggestMapping(["Thing"], { client: ["client", "customer"] });
  assert.equal(mapping.client, null);
});

test("applies a mapping and numbers rows as the user sees them", () => {
  const table = parseCsv("Customer,Domain\nAcme,acme.com\nBorealis,borealis.io\n");
  const mapped = applyMapping(table, { client: 0, label: 1, provider: null });
  assert.equal(mapped[0]!.rowNumber, 2);
  assert.equal(mapped[1]!.rowNumber, 3);
  assert.deepEqual(mapped[0]!.values, { client: "Acme", label: "acme.com", provider: "" });
});
