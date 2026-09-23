import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DomainNameError, isInternationalised, isIpAddress, normaliseHost,
  registrableDomain, toAscii, topLevelDomain,
} from "../src/domain-name.ts";

test("strips scheme, port, path, case and trailing dot", () => {
  assert.equal(normaliseHost("https://Example.COM:8443/path?q=1"), "example.com");
  assert.equal(normaliseHost("  example.com.  "), "example.com");
  assert.equal(normaliseHost("example.com/a/b"), "example.com");
});

test("refuses an empty value", () => {
  assert.throws(() => normaliseHost("   "), DomainNameError);
});

test("finds the registrable domain under a single-label suffix", () => {
  assert.equal(registrableDomain("www.example.com"), "example.com");
  assert.equal(registrableDomain("example.com"), "example.com");
  assert.equal(registrableDomain("a.b.c.example.dev"), "example.dev");
});

test("handles multi-level public suffixes", () => {
  assert.equal(registrableDomain("shop.example.co.uk"), "example.co.uk");
  assert.equal(registrableDomain("example.co.uk"), "example.co.uk");
  assert.equal(registrableDomain("example.com.au"), "example.com.au");
  assert.equal(registrableDomain("site.example.com.et"), "example.com.et");
});

test("a bare public suffix is not a registration", () => {
  assert.equal(registrableDomain("co.uk"), null);
  assert.equal(registrableDomain("com"), null);
});

test("an IP address has no registration to look up", () => {
  assert.ok(isIpAddress("203.0.113.10"));
  assert.ok(isIpAddress("2606:4700::1111"));
  assert.ok(!isIpAddress("example.com"));
  assert.equal(registrableDomain("203.0.113.10"), null);
});

test("treats each site on a shared hosting suffix separately", () => {
  assert.equal(registrableDomain("myproject.github.io"), "myproject.github.io");
  assert.equal(registrableDomain("shop.myshopify.com"), "shop.myshopify.com");
});

test("reports the top-level domain", () => {
  assert.equal(topLevelDomain("www.example.co.uk"), "uk");
  assert.equal(topLevelDomain("example.com"), "com");
  assert.equal(topLevelDomain("203.0.113.10"), null);
});

test("converts internationalised names to punycode", () => {
  assert.equal(toAscii("bücher.de"), "xn--bcher-kva.de");
  assert.ok(isInternationalised("bücher.de"));
  assert.ok(!isInternationalised("example.com"));
  assert.equal(toAscii("example.com"), "example.com");
});
