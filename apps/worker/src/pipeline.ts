/**
 * Turning a check into a stored result and a set of alerts.
 *
 * The shaping is separated from the input and output so it can be tested
 * without a network or a database: given what a checker saw and what the
 * previous check saw, decide what to store and what to raise.
 */

import {
  daysUntilExpiry, hasStatus, lifetimeElapsed,
  type JsonObject, type RdapDomain,
} from "@stackkeeper/core";
import {
  dedupeKey, evaluateDomain, evaluateTls,
  type AlertDecision, type DomainObservation, type TlsObservation as TlsInput,
} from "./alert-rules.ts";
import type { DomainCheckResult } from "./checkers/domain.ts";
import { summariseTlsCheck, type TlsCheckResult } from "./checkers/tls.ts";
import { CHECK_INTERVALS, URGENT_WINDOW_DAYS } from "./jobs.ts";

export type CheckStatus = "ok" | "warning" | "critical" | "error";

export interface PipelineOutcome {
  readonly status: CheckStatus;
  readonly payload: JsonObject;
  readonly alerts: readonly (AlertDecision & { dedupeKey: string; needsPaymentConfirmation: boolean })[];
  readonly nextCheckAt: Date;
  readonly error: string | null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// ---------------------------------------------------------------------------
// TLS
// ---------------------------------------------------------------------------

export function buildTlsOutcome(
  result: TlsCheckResult,
  previous: JsonObject | null,
  now: Date = new Date(),
): PipelineOutcome {
  const summary = summariseTlsCheck(result, now);
  const primary = summary.primary;

  if (!primary) {
    return {
      status: "error",
      payload: { host: result.host, errors: result.errors, checkedAt: now.toISOString() },
      alerts: [],
      // A host that will not answer is retried sooner, but not in a tight loop.
      nextCheckAt: new Date(now.getTime() + CHECK_INTERVALS.tls.urgent),
      error: summary.detail ?? "no certificate could be read",
    };
  }

  const certificate = primary.certificate;
  const payload: JsonObject = {
    host: result.host,
    port: result.port,
    address: primary.address,
    notBefore: certificate.notBefore?.toISOString() ?? null,
    notAfter: certificate.notAfter?.toISOString() ?? null,
    issuer: certificate.issuer,
    subject: certificate.subject,
    serialNumber: certificate.serialNumber,
    fingerprint: certificate.fingerprint,
    sans: certificate.sans,
    lifetimeDays: certificate.lifetimeDays,
    lifetimeUsed: lifetimeElapsed(certificate, now),
    daysRemaining: daysUntilExpiry(certificate, now),
    chainValid: primary.chainValid,
    chainError: primary.chainError,
    hostnameMatches: primary.hostnameMatches,
    protocol: primary.protocol,
    addressesChecked: result.observations.map((o) => o.address),
    inconsistentAcrossAddresses: summary.inconsistent,
    errors: result.errors,
    checkedAt: now.toISOString(),
  };

  const observation: TlsInput = {
    notBefore: certificate.notBefore ?? now,
    notAfter: certificate.notAfter ?? now,
    chainValid: primary.chainValid,
    hostnameMatches: primary.hostnameMatches,
    chainError: primary.chainError,
    issuer: certificate.issuer,
    previousIssuer: typeof previous?.issuer === "string" ? previous.issuer : null,
  };

  const decisions = certificate.notAfter ? evaluateTls(observation, now) : [];
  const identity = certificate.fingerprint ?? result.host;

  const alerts = decisions.map((decision) => ({
    ...decision,
    dedupeKey: dedupeKey("tls", identity, decision.rule),
    needsPaymentConfirmation: false,
  }));

  // A certificate renewed on one address but not another is invisible to
  // anyone loading the site in a browser, so it gets its own alert.
  if (summary.inconsistent) {
    alerts.push({
      rule: "tls_inconsistent_addresses",
      severity: "warning",
      message: summary.detail ?? "Different certificates are being served for this name.",
      dedupeKey: dedupeKey("tls", result.host, "tls_inconsistent_addresses"),
      needsPaymentConfirmation: false,
    });
  }

  const used = lifetimeElapsed(certificate, now) ?? 0;
  const interval = used >= 0.75 ? CHECK_INTERVALS.tls.urgent : CHECK_INTERVALS.tls.normal;

  return {
    status: summary.status,
    payload,
    alerts,
    nextCheckAt: new Date(now.getTime() + interval),
    error: result.errors[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

export function buildDomainOutcome(
  result: DomainCheckResult,
  previous: JsonObject | null,
  manualExpiry: Date | null,
  now: Date = new Date(),
): PipelineOutcome {
  const record: RdapDomain | null = result.record;
  const expiresAt = record?.expiresAt ?? manualExpiry;
  const previousExpiry = parseDate(previous?.expiresAt);
  const previousNameservers = stringList(previous?.nameservers);

  const payload: JsonObject = {
    domain: result.domain,
    source: manualExpiry && !record?.expiresAt ? "manual" : result.source,
    expiresAt: expiresAt?.toISOString() ?? null,
    registeredAt: record?.registeredAt?.toISOString() ?? null,
    lastChangedAt: record?.lastChangedAt?.toISOString() ?? null,
    statuses: record?.statuses ?? [],
    nameservers: record?.nameservers ?? [],
    registrar: record?.registrar ?? null,
    dnssec: record?.dnssec ?? false,
    expiryUnavailable: result.expiryUnavailable,
    error: result.error,
    checkedAt: now.toISOString(),
  };

  if (result.error && !record && !result.expiryUnavailable) {
    return {
      status: "error",
      payload,
      alerts: [],
      nextCheckAt: new Date(now.getTime() + CHECK_INTERVALS.domain.urgent),
      error: result.error,
    };
  }

  const observation: DomainObservation = {
    expiresAt,
    previousExpiresAt: previousExpiry,
    statuses: record?.statuses ?? [],
    nameservers: record?.nameservers ?? [],
    previousNameservers: previousNameservers.length > 0 ? previousNameservers : null,
    // Without a date nothing can be watched, so ask for one until it is entered,
    // whether or not the registry ever publishes it. The first live run showed
    // .de and .nl domains sitting at "ok" with no date and nobody prompted.
    expiryIsManual: manualExpiry !== null,
  };

  const decisions = evaluateDomain(observation, now);

  // The registry auto-renews the day after expiry whether or not anyone paid.
  // Any alert raised while that is in doubt carries the flag, so the interface
  // can ask for confirmation rather than showing a reassuring green tick.
  const unconfirmed = decisions.some((d) => d.rule === "domain_autorenew_unconfirmed");

  const alerts = decisions.map((decision) => ({
    ...decision,
    dedupeKey: dedupeKey("domain", result.domain, decision.rule),
    needsPaymentConfirmation: unconfirmed,
  }));

  const status: CheckStatus = worstSeverity(decisions);

  const days = expiresAt ? (daysUntilExpiry({ notAfter: expiresAt }, now) ?? 999) : 999;
  const onHold = hasStatus(record?.statuses ?? [], "clientHold") ||
    hasStatus(record?.statuses ?? [], "serverHold");
  const urgent = days <= URGENT_WINDOW_DAYS || onHold || unconfirmed;

  return {
    status,
    payload,
    alerts,
    nextCheckAt: new Date(
      now.getTime() + (urgent ? CHECK_INTERVALS.domain.urgent : CHECK_INTERVALS.domain.normal),
    ),
    error: result.error,
  };
}

function worstSeverity(decisions: readonly AlertDecision[]): CheckStatus {
  if (decisions.some((d) => d.severity === "critical")) return "critical";
  if (decisions.some((d) => d.severity === "warning")) return "warning";
  return "ok";
}
