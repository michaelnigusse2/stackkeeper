/**
 * When to raise an alert.
 *
 * Certificate alerts are relative to the share of lifetime used, not a fixed
 * number of days before expiry. Maximum certificate validity falls to 100 days
 * in March 2027 and 47 days in March 2029, and Let's Encrypt already issues
 * six-day certificates, so a rule that warns "30 days before expiry" would
 * fire permanently on a perfectly healthy certificate. A certificate that is
 * renewing normally never passes three quarters of its life; one that has
 * stopped renewing does.
 *
 * Pure functions, so every threshold is testable without a network.
 */

export type Severity = "info" | "warning" | "critical";

export interface TlsObservation {
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly chainValid: boolean;
  readonly hostnameMatches: boolean;
  readonly issuer: string;
  readonly previousIssuer?: string | null;
  /** Node's verification code, when the chain did not validate. */
  readonly chainError?: string | null;
}

function chainMessage(code: string | null | undefined): string {
  switch (code) {
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "The certificate is self-signed. Browsers will show a security warning.";
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
      return "The certificate chain is incomplete: the server is not sending its intermediate certificate. Some browsers and most apps will refuse the connection.";
    default:
      return `The certificate chain does not validate${code ? ` (${code})` : ""}.`;
  }
}

export interface AlertDecision {
  readonly rule: string;
  readonly severity: Severity;
  readonly message: string;
}

/** Share of a certificate's life that has elapsed, from 0 to beyond 1. */
export function lifetimeUsed(observation: TlsObservation, now: Date = new Date()): number {
  const total = observation.notAfter.getTime() - observation.notBefore.getTime();
  if (total <= 0) return 1;
  const elapsed = now.getTime() - observation.notBefore.getTime();
  return elapsed / total;
}

export function evaluateTls(observation: TlsObservation, now: Date = new Date()): AlertDecision[] {
  const decisions: AlertDecision[] = [];
  const msRemaining = observation.notAfter.getTime() - now.getTime();
  const used = lifetimeUsed(observation, now);

  if (msRemaining <= 0) {
    decisions.push({
      rule: "tls_expired",
      severity: "critical",
      message: "The certificate has expired.",
    });
  } else if (msRemaining < 24 * 60 * 60 * 1000 || used >= 0.9) {
    decisions.push({
      rule: "tls_lifetime_90",
      severity: "critical",
      message: "The certificate is past 90% of its lifetime and has not been replaced.",
    });
  } else if (used >= 0.75) {
    decisions.push({
      rule: "tls_lifetime_75",
      severity: "warning",
      message: "The certificate is past three quarters of its lifetime and has not been replaced.",
    });
  }

  if (!observation.chainValid) {
    decisions.push({
      rule: "tls_chain_invalid",
      severity: "critical",
      message: chainMessage(observation.chainError),
    });
  }

  if (!observation.hostnameMatches) {
    decisions.push({
      rule: "tls_hostname_mismatch",
      severity: "critical",
      message: "The certificate does not cover this hostname.",
    });
  }

  if (observation.previousIssuer && observation.previousIssuer !== observation.issuer) {
    decisions.push({
      rule: "tls_issuer_changed",
      severity: "info",
      message: `The issuer changed from ${observation.previousIssuer} to ${observation.issuer}.`,
    });
  }

  return decisions;
}

export interface DomainObservation {
  readonly expiresAt: Date | null;
  readonly previousExpiresAt?: Date | null;
  readonly statuses: readonly string[];
  readonly nameservers: readonly string[];
  readonly previousNameservers?: readonly string[] | null;
  /** True when no registry published the date and a person typed it in. */
  readonly expiryIsManual: boolean;
}

// Ascending, so the tightest threshold a domain has crossed wins. Listed
// descending, `find` would report 60 days for a domain due in 20.
const EXPIRY_WARNING_DAYS = [1, 3, 7, 14, 30, 60];

const CRITICAL_STATUSES = new Set([
  "clienthold", "serverhold", "redemptionperiod", "pendingdelete",
]);

export function evaluateDomain(
  observation: DomainObservation,
  now: Date = new Date(),
): AlertDecision[] {
  const decisions: AlertDecision[] = [];

  for (const status of observation.statuses) {
    if (CRITICAL_STATUSES.has(status.toLowerCase().replace(/\s+/g, ""))) {
      decisions.push({
        rule: `domain_status_${status.toLowerCase()}`,
        severity: "critical",
        message: `The registry reports status ${status}. The domain is at risk now.`,
      });
    }
  }

  // A registry auto-renews the day after expiry whether or not anyone paid,
  // then holds the name in a 45-day grace period. The published date jumps
  // forward by a year and looks healthy while the registrar waits for money
  // that may never arrive, so a jump of exactly one year is reported as
  // unconfirmed rather than treated as a renewal.
  if (observation.expiresAt && observation.previousExpiresAt) {
    const jumped = looksLikeOneYearJump(observation.previousExpiresAt, observation.expiresAt);
    const inGrace = observation.previousExpiresAt.getTime() <= now.getTime();
    if (jumped && inGrace) {
      decisions.push({
        rule: "domain_autorenew_unconfirmed",
        severity: "warning",
        message:
          "The expiry date moved forward a year on the day it expired. That is the registry's " +
          "automatic renewal, which happens before payment is confirmed. Check with the registrar.",
      });
    }
  }

  if (observation.expiresAt) {
    const days = wholeDaysBetween(now, observation.expiresAt);
    const threshold = EXPIRY_WARNING_DAYS.find((d) => days <= d);
    if (days <= 0) {
      decisions.push({
        rule: "domain_expired",
        severity: "critical",
        message: "The registration has passed its expiry date.",
      });
    } else if (threshold !== undefined) {
      decisions.push({
        rule: `domain_expiry_${threshold}d`,
        severity: threshold <= 7 ? "critical" : "warning",
        message: `The registration expires in ${days} day(s).`,
      });
    }
  } else if (!observation.expiryIsManual) {
    decisions.push({
      rule: "domain_expiry_unknown",
      severity: "info",
      message:
        "This registry does not publish an expiry date. Add one by hand so it can be watched.",
    });
  }

  if (observation.previousNameservers && observation.previousNameservers.length > 0) {
    const before = [...observation.previousNameservers].map((n) => n.toLowerCase()).sort();
    const after = [...observation.nameservers].map((n) => n.toLowerCase()).sort();
    if (before.join(",") !== after.join(",")) {
      decisions.push({
        rule: "domain_nameservers_changed",
        severity: "warning",
        message: `The nameservers changed from ${before.join(", ")} to ${after.join(", ") || "none"}.`,
      });
    }
  }

  return decisions;
}

function wholeDaysBetween(from: Date, to: Date): number {
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

function looksLikeOneYearJump(before: Date, after: Date): boolean {
  const expected = new Date(before.getTime());
  expected.setUTCFullYear(expected.getUTCFullYear() + 1);
  return Math.abs(after.getTime() - expected.getTime()) < 2 * 86_400_000;
}

/** One open alert per key, so a wildcard certificate alerts once, not forty times. */
export function dedupeKey(kind: string, identity: string, rule: string): string {
  return `${kind}:${identity}:${rule}`;
}
