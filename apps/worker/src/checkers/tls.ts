import tls from "node:tls";
import {
  certificateCoversHost, daysUntilExpiry, lifetimeElapsed, summariseCertificate,
  type CertificateSummary,
} from "@stackkeeper/core";
import { BlockedHostError, resolveTarget } from "../resolve.ts";

/**
 * Read the certificate a host is actually serving.
 *
 * Two decisions shape this. It connects to each resolved address in turn,
 * because a site behind a CDN or a load balancer can serve a different
 * certificate from each node and a renewal that reached only one of them is
 * exactly the failure worth catching. And it sets `rejectUnauthorized: false`
 * so that an expired or misissued certificate can be inspected and reported
 * rather than refused at the handshake, which would tell us nothing useful.
 */

export interface TlsObservation {
  readonly address: string;
  readonly certificate: CertificateSummary;
  readonly chainValid: boolean;
  readonly chainError: string | null;
  readonly hostnameMatches: boolean;
  readonly protocol: string | null;
  readonly latencyMs: number;
}

export interface TlsCheckResult {
  readonly host: string;
  readonly port: number;
  readonly observations: readonly TlsObservation[];
  readonly errors: readonly string[];
  /** True when every address served a usable certificate. */
  readonly ok: boolean;
}

const HANDSHAKE_TIMEOUT_MS = 10_000;

export async function checkTls(host: string, port = 443): Promise<TlsCheckResult> {
  let target;
  try {
    target = await resolveTarget(host, port);
  } catch (error) {
    if (error instanceof BlockedHostError) {
      return { host, port, observations: [], errors: [error.message], ok: false };
    }
    throw error;
  }

  const observations: TlsObservation[] = [];
  const errors: string[] = [];

  for (const address of target.addresses) {
    try {
      observations.push(await handshake(address, host, port));
    } catch (error) {
      errors.push(`${address}: ${(error as Error).message}`);
    }
  }

  const ok =
    errors.length === 0 &&
    observations.length > 0 &&
    observations.every((o) => o.chainValid && o.hostnameMatches);

  return { host, port, observations, errors, ok };
}

function handshake(address: string, servername: string, port: number): Promise<TlsObservation> {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const socket = tls.connect({
      host: address,
      port,
      // The name in the request, which is what the certificate must cover and
      // what the server uses to decide which certificate to present.
      servername,
      // Inspect rather than refuse: an invalid certificate is the finding.
      rejectUnauthorized: false,
      timeout: HANDSHAKE_TIMEOUT_MS,
      // A connection that lingers is a connection holding a worker slot.
      ALPNProtocols: ["h2", "http/1.1"],
    });

    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.once("secureConnect", () => {
      const peer = socket.getPeerCertificate(false);
      const summary = summariseCertificate(peer as never);
      const authorized = socket.authorized;
      const authorizationError = socket.authorizationError;

      const observation: TlsObservation = {
        address,
        certificate: summary,
        chainValid: authorized,
        chainError: authorized ? null : String(authorizationError ?? "unknown"),
        hostnameMatches: certificateCoversHost(summary, servername),
        protocol: socket.getProtocol(),
        latencyMs: Date.now() - started,
      };

      socket.end();
      resolve(observation);
    });

    socket.once("timeout", () => fail(new Error(`handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`)));
    socket.once("error", (error) => fail(error));
  });
}

/**
 * Reduce several addresses to one verdict.
 *
 * The worst observation wins, and a certificate renewed on one address but not
 * another is called out explicitly, because that is invisible to anyone
 * checking the site in a browser.
 */
export function summariseTlsCheck(result: TlsCheckResult, now: Date = new Date()): {
  status: "ok" | "warning" | "critical" | "error";
  primary: TlsObservation | null;
  inconsistent: boolean;
  detail: string | null;
} {
  if (result.observations.length === 0) {
    return { status: "error", primary: null, inconsistent: false, detail: result.errors[0] ?? "no response" };
  }

  // Worst first: the certificate closest to the end of its life.
  const sorted = [...result.observations].sort((a, b) => {
    const left = lifetimeElapsed(a.certificate, now) ?? 1;
    const right = lifetimeElapsed(b.certificate, now) ?? 1;
    return right - left;
  });
  const primary = sorted[0] ?? null;

  const fingerprints = new Set(
    result.observations.map((o) => o.certificate.fingerprint ?? "unknown"),
  );
  const inconsistent = fingerprints.size > 1;

  let status: "ok" | "warning" | "critical" | "error" = "ok";
  if (result.errors.length > 0) status = "error";
  if (primary) {
    const remaining = daysUntilExpiry(primary.certificate, now);
    const used = lifetimeElapsed(primary.certificate, now) ?? 0;
    if (!primary.chainValid || !primary.hostnameMatches || (remaining !== null && remaining < 0)) {
      status = "critical";
    } else if (used >= 0.9) {
      status = "critical";
    } else if (used >= 0.75) {
      status = "warning";
    }
  }

  return {
    status,
    primary,
    inconsistent,
    detail: inconsistent
      ? `${fingerprints.size} different certificates are being served for this name`
      : (result.errors[0] ?? null),
  };
}
