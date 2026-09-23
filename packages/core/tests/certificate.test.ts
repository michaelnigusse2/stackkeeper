import { test } from "node:test";
import assert from "node:assert/strict";
import {
  certificateCoversHost, daysUntilExpiry, issuerName, lifetimeElapsed,
  nameCoversHost, parseCertificateDate, parseSubjectAltNames, summariseCertificate,
} from "../src/certificate.ts";

const LETS_ENCRYPT = {
  subject: { CN: "example.com" },
  issuer: { CN: "R11", O: "Let's Encrypt" },
  valid_from: "Sep  1 00:00:00 2026 GMT",
  valid_to: "Nov 30 00:00:00 2026 GMT",
  fingerprint256: "AB:CD:EF:01:23:45",
  serialNumber: "04A1B2C3",
  subjectaltname: "DNS:example.com, DNS:www.example.com",
};

test("reads the date format OpenSSL emits, padding and all", () => {
  assert.equal(parseCertificateDate("Sep  1 00:00:00 2026 GMT")?.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(parseCertificateDate("Nov 30 23:59:59 2026 GMT")?.toISOString(), "2026-11-30T23:59:59.000Z");
  assert.equal(parseCertificateDate("not a date"), null);
  assert.equal(parseCertificateDate(undefined), null);
});

test("splits subject alternative names and drops the type prefix", () => {
  assert.deepEqual(
    parseSubjectAltNames("DNS:example.com, DNS:*.Example.com, IP Address:1.2.3.4"),
    ["example.com", "*.example.com", "1.2.3.4"],
  );
  assert.deepEqual(parseSubjectAltNames(undefined), []);
});

test("a wildcard covers exactly one label, and not the bare domain", () => {
  assert.ok(nameCoversHost("*.example.com", "www.example.com"));
  assert.ok(nameCoversHost("*.example.com", "api.example.com"));
  assert.ok(!nameCoversHost("*.example.com", "example.com"));
  assert.ok(!nameCoversHost("*.example.com", "a.b.example.com"));
  assert.ok(!nameCoversHost("*.example.com", "www.example.org"));
});

test("exact names match, ignoring case and a trailing dot", () => {
  assert.ok(nameCoversHost("Example.COM", "example.com."));
  assert.ok(!nameCoversHost("", "example.com"));
  assert.ok(!nameCoversHost("example.com", ""));
});

test("summarises a certificate", () => {
  const summary = summariseCertificate(LETS_ENCRYPT);
  assert.equal(summary.notBefore?.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(summary.notAfter?.toISOString(), "2026-11-30T00:00:00.000Z");
  assert.equal(summary.issuer, "Let's Encrypt R11");
  assert.equal(summary.subject, "example.com");
  assert.equal(summary.fingerprint, "AB:CD:EF:01:23:45");
  assert.deepEqual(summary.sans, ["example.com", "www.example.com"]);
  assert.equal(summary.lifetimeDays, 90);
});

test("names the issuer sensibly whichever fields are present", () => {
  assert.equal(issuerName({ issuer: { O: "Let's Encrypt", CN: "R11" } }), "Let's Encrypt R11");
  assert.equal(issuerName({ issuer: { CN: "R11" } }), "R11");
  assert.equal(issuerName({ issuer: { O: "DigiCert", CN: "DigiCert" } }), "DigiCert");
  assert.equal(issuerName({}), "unknown issuer");
});

test("decides whether a certificate covers the host asked for", () => {
  const summary = summariseCertificate(LETS_ENCRYPT);
  assert.ok(certificateCoversHost(summary, "example.com"));
  assert.ok(certificateCoversHost(summary, "www.example.com"));
  assert.ok(!certificateCoversHost(summary, "shop.example.com"));

  const wildcard = summariseCertificate({
    ...LETS_ENCRYPT,
    subjectaltname: "DNS:*.example.com",
    subject: { CN: "*.example.com" },
  });
  assert.ok(certificateCoversHost(wildcard, "shop.example.com"));
  assert.ok(!certificateCoversHost(wildcard, "example.com"));
});

test("measures lifetime as a share, not a countdown", () => {
  const summary = summariseCertificate(LETS_ENCRYPT);
  const atStart = lifetimeElapsed(summary, new Date("2026-09-01T00:00:00Z"));
  const midway = lifetimeElapsed(summary, new Date("2026-10-16T00:00:00Z"));
  assert.ok(atStart !== null && atStart < 0.01);
  assert.ok(midway !== null && Math.abs(midway - 0.5) < 0.02);
});

test("a six-day certificate is judged the same way as a ninety-day one", () => {
  const short = summariseCertificate({
    ...LETS_ENCRYPT,
    valid_from: "Sep 20 00:00:00 2026 GMT",
    valid_to: "Sep 26 00:00:00 2026 GMT",
  });
  assert.equal(short.lifetimeDays, 6);
  // One day in: well inside its life, even though expiry is five days away.
  const used = lifetimeElapsed(short, new Date("2026-09-21T00:00:00Z"));
  assert.ok(used !== null && Math.abs(used - 1 / 6) < 0.01);
  assert.equal(daysUntilExpiry(short, new Date("2026-09-21T00:00:00Z")), 5);
});

test("returns null rather than guessing when dates are missing", () => {
  const empty = summariseCertificate({});
  assert.equal(empty.lifetimeDays, null);
  assert.equal(lifetimeElapsed(empty), null);
  assert.equal(daysUntilExpiry(empty), null);
});

test("an inverted validity period counts as fully elapsed", () => {
  const broken = summariseCertificate({
    valid_from: "Dec  1 00:00:00 2026 GMT",
    valid_to: "Sep  1 00:00:00 2026 GMT",
  });
  assert.equal(lifetimeElapsed(broken, new Date("2026-10-01T00:00:00Z")), 1);
});
