/**
 * Run the real monitoring checks against real domains, with no database.
 *
 *   pnpm --filter @stackkeeper/worker check:live
 *   pnpm --filter @stackkeeper/worker check:live mysite.com client.co.uk
 *
 * Everything the worker does to a monitor happens here too: the RDAP lookup
 * with WHOIS fallback, a TLS handshake on every address, and the alert rules.
 * Nothing is stored. The unit tests cover the logic against recorded
 * shapes; this is the check that the network half works where it will run.
 *
 * Prints a table and writes live-check-results.json next to where it runs.
 * The default list mixes ordinary domains with registries that behave oddly
 * (.de and .nl publish no expiry, .et has no public lookup at all) and
 * badssl.com hosts that serve deliberately broken certificates.
 */

import { writeFileSync } from "node:fs";
import { registrableDomain } from "@stackkeeper/core";
import { checkDomain, loadBootstrap } from "./checkers/domain.ts";
import { checkTls } from "./checkers/tls.ts";
import { buildDomainOutcome, buildTlsOutcome } from "./pipeline.ts";
import { HostRateLimiter } from "./rate-limiter.ts";

const DEFAULTS: readonly { host: string; expect: string }[] = [
  { host: "example.com", expect: "healthy: .com over RDAP" },
  { host: "github.com", expect: "healthy" },
  { host: "wikipedia.org", expect: "healthy: .org over RDAP" },
  { host: "bbc.co.uk", expect: "healthy: multi-level suffix, Nominet" },
  { host: "heise.de", expect: "no public expiry: .de publishes none" },
  { host: "sidn.nl", expect: "no public expiry: .nl publishes none" },
  { host: "ethiotelecom.et", expect: "no lookup server for .et; manual date needed" },
  { host: "letsencrypt.org", expect: "short-lived certificate, judged on lifetime" },
  { host: "expired.badssl.com", expect: "TLS critical: expired certificate" },
  { host: "wrong.host.badssl.com", expect: "TLS critical: name mismatch" },
  { host: "self-signed.badssl.com", expect: "TLS critical: untrusted chain" },
];

interface Row {
  host: string;
  expect: string;
  domain: string | null;
  domainStatus: string;
  source: string;
  expires: string | null;
  registrar: string | null;
  tlsStatus: string;
  issuer: string | null;
  certExpires: string | null;
  lifetimeUsed: string | null;
  alerts: string[];
  errors: string[];
}

function day(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 10) : null;
}

async function checkOne(host: string, expect: string, limiter: HostRateLimiter): Promise<Row> {
  const domain = registrableDomain(host);
  const row: Row = {
    host, expect, domain,
    domainStatus: "-", source: "-", expires: null, registrar: null,
    tlsStatus: "-", issuer: null, certExpires: null, lifetimeUsed: null,
    alerts: [], errors: [],
  };

  if (domain) {
    try {
      const result = await checkDomain(domain, { limiter });
      const outcome = buildDomainOutcome(result, null, null);
      row.domainStatus = outcome.status;
      row.source = String(outcome.payload.source ?? "-");
      row.expires = day(outcome.payload.expiresAt);
      row.registrar = typeof outcome.payload.registrar === "string" ? outcome.payload.registrar : null;
      row.alerts.push(...outcome.alerts.map((a) => `[domain ${a.severity}] ${a.message}`));
      if (outcome.error) row.errors.push(`domain: ${outcome.error}`);
    } catch (error) {
      row.domainStatus = "crashed";
      row.errors.push(`domain: ${(error as Error).message}`);
    }
  }

  try {
    const outcome = buildTlsOutcome(await checkTls(host, 443), null);
    row.tlsStatus = outcome.status;
    row.issuer = typeof outcome.payload.issuer === "string" ? outcome.payload.issuer : null;
    row.certExpires = day(outcome.payload.notAfter);
    const used = outcome.payload.lifetimeUsed;
    row.lifetimeUsed = typeof used === "number" ? `${Math.round(used * 100)}%` : null;
    row.alerts.push(...outcome.alerts.map((a) => `[tls ${a.severity}] ${a.message}`));
    if (outcome.error) row.errors.push(`tls: ${outcome.error}`);
  } catch (error) {
    row.tlsStatus = "crashed";
    row.errors.push(`tls: ${(error as Error).message}`);
  }
  return row;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const targets = args.length > 0 ? args.map((host) => ({ host, expect: "" })) : DEFAULTS;

  const bootstrap = await loadBootstrap();
  console.log(bootstrap ? "IANA RDAP bootstrap: loaded" : "IANA RDAP bootstrap: FAILED to load (no network?)");

  // The same politeness the worker uses: one request a second per registry.
  const limiter = new HostRateLimiter({ ratePerSecond: 1, burst: 3 });
  const rows: Row[] = [];
  for (const { host, expect } of targets) {
    process.stdout.write(`checking ${host} ... `);
    const row = await checkOne(host, expect, limiter);
    rows.push(row);
    console.log(`domain ${row.domainStatus}, tls ${row.tlsStatus}`);
  }

  console.log("");
  for (const row of rows) {
    console.log(`${row.host}${row.expect ? `   (expected: ${row.expect})` : ""}`);
    console.log(`  registration  ${row.domainStatus.padEnd(8)} via ${row.source}, expires ${row.expires ?? "unknown"}${row.registrar ? `, ${row.registrar}` : ""}`);
    console.log(`  certificate   ${row.tlsStatus.padEnd(8)} ${row.issuer ?? ""}${row.certExpires ? `, expires ${row.certExpires}` : ""}${row.lifetimeUsed ? ` (${row.lifetimeUsed} of its life used)` : ""}`);
    for (const alert of row.alerts) console.log(`  ${alert}`);
    for (const error of row.errors) console.log(`  error: ${error}`);
    console.log("");
  }

  const file = "live-check-results.json";
  writeFileSync(file, `${JSON.stringify({ ranAt: new Date().toISOString(), node: process.version, rows }, null, 2)}\n`);
  console.log(`Saved ${file}. Send it over if anything looks wrong.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
