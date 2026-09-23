/**
 * Deciding what to watch for a given asset.
 *
 * Monitors are created from the asset rather than asked for, because a person
 * adding a domain has already told us everything needed to watch it, and a
 * separate "now set up monitoring" step is one most people would skip.
 *
 * The rule is conservative: watch only what can genuinely be checked from
 * outside. A server recorded by IP address has no certificate and no
 * registration to look up, so it gets nothing rather than a monitor that
 * fails forever.
 */

import { isIpAddress, normaliseHost, registrableDomain } from "./domain-name.ts";

export type PlannedMonitorKind = "domain_expiry" | "tls";

export interface PlannedMonitor {
  readonly kind: PlannedMonitorKind;
  readonly target: string;
  readonly reason: string;
}

export interface AssetLike {
  readonly kind: string;
  readonly label: string;
  readonly identifier?: string | null;
}

/** The first value that looks like a hostname, preferring the identifier. */
function hostFrom(asset: AssetLike): string | null {
  for (const candidate of [asset.identifier, asset.label]) {
    if (!candidate) continue;
    try {
      const host = normaliseHost(candidate);
      if (isIpAddress(host)) continue;
      if (!host.includes(".")) continue;
      return host;
    } catch {
      continue;
    }
  }
  return null;
}

export function planMonitors(asset: AssetLike): PlannedMonitor[] {
  const host = hostFrom(asset);
  if (!host) return [];

  const planned: PlannedMonitor[] = [];
  const registrable = registrableDomain(host);

  // A registration is watched at the registrable name, not the hostname: the
  // registry knows example.com, not www.example.com.
  if (registrable && (asset.kind === "domain" || asset.kind === "dns")) {
    planned.push({
      kind: "domain_expiry",
      target: registrable,
      reason: "Watches the registration for expiry, holds and nameserver changes",
    });
  }

  if (["domain", "certificate", "hosting", "cdn", "server"].includes(asset.kind)) {
    planned.push({
      kind: "tls",
      target: host,
      reason: "Reads the certificate this name actually serves",
    });
  }

  return planned;
}

/** True when this asset has something worth watching. */
export function isMonitorable(asset: AssetLike): boolean {
  return planMonitors(asset).length > 0;
}
