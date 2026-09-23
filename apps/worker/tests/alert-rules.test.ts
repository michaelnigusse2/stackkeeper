import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeKey, evaluateDomain, evaluateTls, lifetimeUsed,
  type DomainObservation, type TlsObservation,
} from "../src/alert-rules.ts";

const NOW = new Date("2026-09-20T12:00:00Z");

function cert(over: Partial<TlsObservation> = {}): TlsObservation {
  return {
    notBefore: new Date("2026-09-01T00:00:00Z"),
    notAfter: new Date("2026-12-01T00:00:00Z"),
    chainValid: true,
    hostnameMatches: true,
    issuer: "Let's Encrypt",
    ...over,
  };
}

function rules(decisions: ReturnType<typeof evaluateTls>): string[] {
  return decisions.map((d) => d.rule);
}

test("a healthy certificate raises nothing", () => {
  assert.deepEqual(evaluateTls(cert(), NOW), []);
});

test("measures lifetime as a share, not a countdown", () => {
  const short = cert({
    notBefore: new Date("2026-09-19T00:00:00Z"),
    notAfter: new Date("2026-09-25T00:00:00Z"),
  });
  assert.ok(Math.abs(lifetimeUsed(short, NOW) - 1.5 / 6) < 0.01);
});

test("a six-day certificate renewing normally is not alerted on", () => {
  // Under a fixed "warn 30 days before expiry" rule this would alert forever.
  const sixDay = cert({
    notBefore: new Date("2026-09-20T00:00:00Z"),
    notAfter: new Date("2026-09-26T00:00:00Z"),
  });
  assert.deepEqual(evaluateTls(sixDay, NOW), []);
});

test("a six-day certificate that stopped renewing is caught", () => {
  const stale = cert({
    notBefore: new Date("2026-09-15T00:00:00Z"),
    notAfter: new Date("2026-09-21T00:00:00Z"),
  });
  assert.deepEqual(rules(evaluateTls(stale, NOW)), ["tls_lifetime_90"]);
});

test("warns at three quarters and escalates at ninety percent", () => {
  const threeQuarters = cert({
    notBefore: new Date("2026-08-21T12:00:00Z"),
    notAfter: new Date("2026-09-30T12:00:00Z"),
  });
  assert.deepEqual(rules(evaluateTls(threeQuarters, NOW)), ["tls_lifetime_75"]);

  const ninety = cert({
    notBefore: new Date("2026-08-11T12:00:00Z"),
    notAfter: new Date("2026-09-24T12:00:00Z"),
  });
  assert.deepEqual(rules(evaluateTls(ninety, NOW)), ["tls_lifetime_90"]);
});

test("an expired certificate is critical", () => {
  const expired = cert({ notAfter: new Date("2026-09-19T00:00:00Z") });
  assert.ok(rules(evaluateTls(expired, NOW)).includes("tls_expired"));
});

test("names what is wrong with a chain", () => {
  const message = (chainError: string) =>
    evaluateTls(cert({ chainValid: false, chainError }), NOW).find((d) => d.rule === "tls_chain_invalid")?.message ?? "";
  assert.match(message("DEPTH_ZERO_SELF_SIGNED_CERT"), /self-signed/);
  assert.match(message("UNABLE_TO_VERIFY_LEAF_SIGNATURE"), /intermediate/);
  assert.match(message("CERT_REVOKED"), /CERT_REVOKED/);
});

test("reports a broken chain, a wrong hostname and a changed issuer", () => {
  const broken = evaluateTls(
    cert({ chainValid: false, hostnameMatches: false, previousIssuer: "DigiCert" }),
    NOW,
  );
  const found = rules(broken);
  assert.ok(found.includes("tls_chain_invalid"));
  assert.ok(found.includes("tls_hostname_mismatch"));
  assert.ok(found.includes("tls_issuer_changed"));
  assert.equal(broken.find((d) => d.rule === "tls_issuer_changed")?.severity, "info");
});

function domain(over: Partial<DomainObservation> = {}): DomainObservation {
  return {
    expiresAt: new Date("2027-06-01T00:00:00Z"),
    statuses: ["clientTransferProhibited"],
    nameservers: ["ns1.example.com", "ns2.example.com"],
    expiryIsManual: false,
    ...over,
  };
}

test("a domain renewing far out raises nothing", () => {
  assert.deepEqual(evaluateDomain(domain(), NOW), []);
});

test("warns on the expected ladder as expiry approaches", () => {
  const cases: Array<[string, string, string]> = [
    ["2026-11-01T00:00:00Z", "domain_expiry_60d", "warning"],
    ["2026-10-10T00:00:00Z", "domain_expiry_30d", "warning"],
    ["2026-09-30T00:00:00Z", "domain_expiry_14d", "warning"],
    ["2026-09-25T00:00:00Z", "domain_expiry_7d", "critical"],
    ["2026-09-23T00:00:00Z", "domain_expiry_3d", "critical"],
    ["2026-09-21T00:00:00Z", "domain_expiry_1d", "critical"],
  ];
  for (const [date, rule, severity] of cases) {
    const decisions = evaluateDomain(domain({ expiresAt: new Date(date) }), NOW);
    const match = decisions.find((d) => d.rule === rule);
    assert.ok(match, `${date} should raise ${rule}, got ${decisions.map((d) => d.rule).join(",")}`);
    assert.equal(match.severity, severity);
  }
});

test("treats a registry hold as critical immediately", () => {
  for (const status of ["clientHold", "serverHold", "redemptionPeriod", "pendingDelete"]) {
    const decisions = evaluateDomain(domain({ statuses: [status] }), NOW);
    assert.ok(
      decisions.some((d) => d.severity === "critical" && d.rule.startsWith("domain_status_")),
      `${status} should be critical`,
    );
  }
});

test("does not mistake the registry's automatic renewal for a paid one", () => {
  // The name expired yesterday and the date jumped forward exactly a year.
  const decisions = evaluateDomain(
    domain({
      previousExpiresAt: new Date("2026-09-19T00:00:00Z"),
      expiresAt: new Date("2027-09-19T00:00:00Z"),
    }),
    NOW,
  );
  const match = decisions.find((d) => d.rule === "domain_autorenew_unconfirmed");
  assert.ok(match, "should flag the renewal as unconfirmed");
  assert.equal(match.severity, "warning");
});

test("a genuine renewal well before expiry is not flagged as unconfirmed", () => {
  const decisions = evaluateDomain(
    domain({
      previousExpiresAt: new Date("2027-06-01T00:00:00Z"),
      expiresAt: new Date("2028-06-01T00:00:00Z"),
    }),
    NOW,
  );
  assert.ok(!decisions.some((d) => d.rule === "domain_autorenew_unconfirmed"));
});

test("says so when a registry publishes no expiry date at all", () => {
  const decisions = evaluateDomain(domain({ expiresAt: null }), NOW);
  assert.ok(decisions.some((d) => d.rule === "domain_expiry_unknown"));

  // Once a person has entered the date, stop nagging.
  const manual = evaluateDomain(domain({ expiresAt: null, expiryIsManual: true }), NOW);
  assert.ok(!manual.some((d) => d.rule === "domain_expiry_unknown"));
});

test("flags a nameserver change as a possible hijack", () => {
  const decisions = evaluateDomain(
    domain({
      previousNameservers: ["ns1.example.com", "ns2.example.com"],
      nameservers: ["ns1.parking.example", "ns2.parking.example"],
    }),
    NOW,
  );
  assert.ok(decisions.some((d) => d.rule === "domain_nameservers_changed"));
});

test("ignores nameserver reordering", () => {
  const decisions = evaluateDomain(
    domain({
      previousNameservers: ["NS2.example.com", "ns1.example.com"],
      nameservers: ["ns1.example.com", "ns2.example.com"],
    }),
    NOW,
  );
  assert.ok(!decisions.some((d) => d.rule === "domain_nameservers_changed"));
});

test("one open alert per fingerprint and rule", () => {
  assert.equal(dedupeKey("tls", "ab12cd", "tls_lifetime_75"), "tls:ab12cd:tls_lifetime_75");
});
