import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseCertificate } from "@stackkeeper/core";
import { buildDomainOutcome, buildTlsOutcome } from "../src/pipeline.ts";
import { isChainFault, type TlsCheckResult } from "../src/checkers/tls.ts";
import type { DomainCheckResult } from "../src/checkers/domain.ts";

const NOW = new Date("2026-09-21T12:00:00Z");

function tlsResult(over: Partial<TlsCheckResult> = {}, certOver = {}): TlsCheckResult {
  const certificate = summariseCertificate({
    subject: { CN: "example.com" },
    issuer: { CN: "R11", O: "Let's Encrypt" },
    valid_from: "Sep  1 00:00:00 2026 GMT",
    valid_to: "Nov 30 00:00:00 2026 GMT",
    fingerprint256: "AB:CD:EF",
    subjectaltname: "DNS:example.com",
    ...certOver,
  });
  return {
    host: "example.com",
    port: 443,
    observations: [
      {
        address: "203.0.113.10",
        certificate,
        chainValid: true,
        chainError: null,
        hostnameMatches: true,
        protocol: "TLSv1.3",
        latencyMs: 42,
      },
    ],
    errors: [],
    ok: true,
    ...over,
  };
}

test("a healthy certificate stores a full record and raises nothing", () => {
  const outcome = buildTlsOutcome(tlsResult(), null, NOW);
  assert.equal(outcome.status, "ok");
  assert.deepEqual(outcome.alerts, []);
  assert.equal(outcome.payload.issuer, "Let's Encrypt R11");
  assert.equal(outcome.payload.lifetimeDays, 90);
  assert.equal(outcome.payload.chainValid, true);
  assert.equal(outcome.error, null);
  // Checked hourly while healthy, which also covers six-day certificates.
  assert.equal(outcome.nextCheckAt.getTime() - NOW.getTime(), 60 * 60 * 1000);
});

test("a certificate past three quarters of its life warns and is checked sooner", () => {
  const outcome = buildTlsOutcome(
    tlsResult({}, { valid_from: "Sep  1 00:00:00 2026 GMT", valid_to: "Sep 26 00:00:00 2026 GMT" }),
    null,
    NOW,
  );
  assert.equal(outcome.status, "warning");
  assert.ok(outcome.alerts.some((a) => a.rule === "tls_lifetime_75"));
  assert.equal(outcome.nextCheckAt.getTime() - NOW.getTime(), 15 * 60 * 1000);
});

test("one open alert per fingerprint and rule", () => {
  const outcome = buildTlsOutcome(
    tlsResult({}, { valid_from: "Sep  1 00:00:00 2026 GMT", valid_to: "Sep 26 00:00:00 2026 GMT" }),
    null,
    NOW,
  );
  assert.equal(outcome.alerts[0]?.dedupeKey, "tls:AB:CD:EF:tls_lifetime_75");
});

test("notices a changed issuer by comparing with the previous check", () => {
  const outcome = buildTlsOutcome(tlsResult(), { issuer: "DigiCert" }, NOW);
  assert.ok(outcome.alerts.some((a) => a.rule === "tls_issuer_changed"));
});

test("calls out a certificate renewed on one address but not another", () => {
  const base = tlsResult();
  const second = {
    ...base.observations[0]!,
    address: "203.0.113.11",
    certificate: summariseCertificate({
      valid_from: "Sep  1 00:00:00 2026 GMT",
      valid_to: "Nov 30 00:00:00 2026 GMT",
      fingerprint256: "ZZ:YY:XX",
      subjectaltname: "DNS:example.com",
    }),
  };
  const outcome = buildTlsOutcome(
    { ...base, observations: [base.observations[0]!, second] },
    null,
    NOW,
  );
  assert.equal(outcome.payload.inconsistentAcrossAddresses, true);
  assert.ok(outcome.alerts.some((a) => a.rule === "tls_inconsistent_addresses"));
});

test("a host that will not answer is an error, not a false all-clear", () => {
  const outcome = buildTlsOutcome(
    { host: "example.com", port: 443, observations: [], errors: ["connection refused"], ok: false },
    null,
    NOW,
  );
  assert.equal(outcome.status, "error");
  assert.deepEqual(outcome.alerts, []);
  assert.match(outcome.error ?? "", /connection refused/);
});

function domainResult(over: Partial<DomainCheckResult> = {}): DomainCheckResult {
  return {
    domain: "example.com",
    source: "rdap",
    record: {
      domain: "example.com",
      expiresAt: new Date("2027-08-13T04:00:00Z"),
      registeredAt: null,
      lastChangedAt: null,
      statuses: ["client transfer prohibited"],
      nameservers: ["ns1.example.com"],
      registrar: "Example Registrar",
      dnssec: false,
      events: [],
    },
    expiryUnavailable: false,
    error: null,
    ...over,
  };
}

test("a domain renewing far out is quiet and checked daily", () => {
  const outcome = buildDomainOutcome(domainResult(), null, null, NOW);
  assert.equal(outcome.status, "ok");
  assert.deepEqual(outcome.alerts, []);
  assert.equal(outcome.payload.registrar, "Example Registrar");
  assert.equal(outcome.nextCheckAt.getTime() - NOW.getTime(), 24 * 60 * 60 * 1000);
});

test("a domain close to expiry alerts and moves to a six-hour cadence", () => {
  const soon = domainResult({
    record: { ...domainResult().record!, expiresAt: new Date("2026-09-28T00:00:00Z") },
  });
  const outcome = buildDomainOutcome(soon, null, null, NOW);
  assert.equal(outcome.status, "critical");
  assert.ok(outcome.alerts.some((a) => a.rule.startsWith("domain_expiry_")));
  assert.equal(outcome.nextCheckAt.getTime() - NOW.getTime(), 6 * 60 * 60 * 1000);
});

test("the registry's automatic renewal is flagged for confirmation, not celebrated", () => {
  const rolled = domainResult({
    record: { ...domainResult().record!, expiresAt: new Date("2027-09-20T00:00:00Z") },
  });
  const outcome = buildDomainOutcome(
    rolled,
    { expiresAt: "2026-09-20T00:00:00Z", nameservers: ["ns1.example.com"] },
    null,
    NOW,
  );
  const alert = outcome.alerts.find((a) => a.rule === "domain_autorenew_unconfirmed");
  assert.ok(alert, "should flag the roll-forward");
  assert.equal(alert.needsPaymentConfirmation, true);
  assert.ok(outcome.alerts.every((a) => a.needsPaymentConfirmation));
});

test("a hold status puts the domain on the urgent cadence", () => {
  const held = domainResult({
    record: { ...domainResult().record!, statuses: ["clientHold"] },
  });
  const outcome = buildDomainOutcome(held, null, null, NOW);
  assert.equal(outcome.status, "critical");
  assert.equal(outcome.nextCheckAt.getTime() - NOW.getTime(), 6 * 60 * 60 * 1000);
});

test("a manual date is used where the registry publishes none", () => {
  const de = domainResult({
    domain: "example.de",
    expiryUnavailable: true,
    record: { ...domainResult().record!, expiresAt: null, statuses: [] },
  });
  const outcome = buildDomainOutcome(de, null, new Date("2026-10-05T00:00:00Z"), NOW);
  assert.equal(outcome.payload.source, "manual");
  assert.equal(outcome.payload.expiresAt, "2026-10-05T00:00:00.000Z");
  assert.ok(outcome.alerts.some((a) => a.rule.startsWith("domain_expiry_")));
  // And it does not nag for a date it already has.
  assert.ok(!outcome.alerts.some((a) => a.rule === "domain_expiry_unknown"));
});

test("asks for a date where the registry publishes none and none was entered", () => {
  const de = domainResult({
    domain: "example.de",
    expiryUnavailable: true,
    record: { ...domainResult().record!, expiresAt: null, statuses: [] },
  });
  const outcome = buildDomainOutcome(de, null, null, NOW);
  assert.ok(outcome.alerts.some((a) => a.rule === "domain_expiry_unknown"));
});

test("a registry with no lookup server is not an error when a date is entered", () => {
  const et = domainResult({
    domain: "ethiotelecom.et",
    source: "none",
    record: null,
    expiryUnavailable: true,
    error: "No registry would answer for .et",
  });
  const outcome = buildDomainOutcome(et, null, new Date("2027-03-01T00:00:00Z"), NOW);
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.payload.source, "manual");
});

test("a hostname mismatch or an expired leaf is not reported as a broken chain", () => {
  assert.equal(isChainFault(null), false);
  assert.equal(isChainFault("ERR_TLS_CERT_ALTNAME_INVALID"), false);
  assert.equal(isChainFault("CERT_HAS_EXPIRED"), false);
  assert.equal(isChainFault("DEPTH_ZERO_SELF_SIGNED_CERT"), true);
  assert.equal(isChainFault("UNABLE_TO_VERIFY_LEAF_SIGNATURE"), true);
});

test("one address timing out while another answers is a warning, not an error", () => {
  const outcome = buildTlsOutcome(tlsResult({ errors: ["151.101.0.81: handshake timed out"] }), null, NOW);
  assert.equal(outcome.status, "warning");
});

test("asks for a date when a registry that normally publishes one returns nothing", () => {
  const blank = domainResult({
    record: { ...domainResult().record!, expiresAt: null, statuses: [] },
  });
  const outcome = buildDomainOutcome(blank, null, null, NOW);
  assert.ok(outcome.alerts.some((a) => a.rule === "domain_expiry_unknown"));
});

test("a nameserver change is reported as a possible hijack", () => {
  const outcome = buildDomainOutcome(
    domainResult(),
    { expiresAt: "2027-08-13T04:00:00Z", nameservers: ["ns1.oldhost.example"] },
    null,
    NOW,
  );
  assert.ok(outcome.alerts.some((a) => a.rule === "domain_nameservers_changed"));
});

test("a registry that would not answer is an error with no alerts", () => {
  const outcome = buildDomainOutcome(
    domainResult({ source: "none", record: null, error: "rdap.example is rate limiting us (429)" }),
    null,
    null,
    NOW,
  );
  assert.equal(outcome.status, "error");
  assert.deepEqual(outcome.alerts, []);
  assert.equal(outcome.nextCheckAt.getTime() - NOW.getTime(), 6 * 60 * 60 * 1000);
});
