import net from "node:net";
import {
  parseRdapDomain, parseWhois, publishesExpiry, rdapUrlFor, registrableDomain,
  toAscii, whoisHostFor, type BootstrapFile, type RdapDomain,
} from "@stackkeeper/core";
import { HostRateLimiter } from "../rate-limiter.ts";

/**
 * Looking up a domain registration.
 *
 * RDAP first, because ICANN made it the definitive source for generic
 * top-level domains in January 2025 and sunset WHOIS for them. Port 43 WHOIS
 * is the fallback for the roughly 40% of country-code registries with no RDAP
 * service. Where neither publishes an expiry date, that fact is reported so
 * the interface can ask for one rather than show a reassuring blank.
 *
 * Registries rate-limit hard, so every request passes through a per-host token
 * bucket and a 429 or 403 puts that host into a doubling back-off.
 */

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const WHOIS_TIMEOUT_MS = 10_000;

export type LookupSource = "rdap" | "whois" | "none";

export interface DomainCheckResult {
  readonly domain: string;
  readonly source: LookupSource;
  readonly record: RdapDomain | null;
  /** True when this registry publishes no expiry date for anyone. */
  readonly expiryUnavailable: boolean;
  readonly error: string | null;
}

let bootstrapCache: { file: BootstrapFile; fetchedAt: number } | null = null;

/** The IANA bootstrap file, cached for a day. */
export async function loadBootstrap(fetchImpl: typeof fetch = fetch): Promise<BootstrapFile | null> {
  if (bootstrapCache && Date.now() - bootstrapCache.fetchedAt < BOOTSTRAP_TTL_MS) {
    return bootstrapCache.file;
  }
  try {
    const response = await fetchImpl(BOOTSTRAP_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return bootstrapCache?.file ?? null;
    const file = (await response.json()) as BootstrapFile;
    bootstrapCache = { file, fetchedAt: Date.now() };
    return file;
  } catch {
    // A stale copy beats no copy; the registry list changes slowly.
    return bootstrapCache?.file ?? null;
  }
}

export interface DomainCheckOptions {
  readonly limiter?: HostRateLimiter;
  readonly fetchImpl?: typeof fetch;
  readonly bootstrap?: BootstrapFile | null;
}

export async function checkDomain(
  input: string,
  options: DomainCheckOptions = {},
): Promise<DomainCheckResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter = options.limiter;

  let domain: string;
  try {
    const registrable = registrableDomain(toAscii(input));
    if (!registrable) {
      return {
        domain: input,
        source: "none",
        record: null,
        expiryUnavailable: false,
        error: "That is not a registrable domain name",
      };
    }
    domain = registrable;
  } catch (error) {
    return {
      domain: input,
      source: "none",
      record: null,
      expiryUnavailable: false,
      error: (error as Error).message,
    };
  }

  const tld = domain.split(".").pop() ?? "";
  const expiryUnavailable = !publishesExpiry(tld);

  const bootstrap = options.bootstrap ?? (await loadBootstrap(fetchImpl));
  const url = rdapUrlFor(domain, bootstrap);

  if (url) {
    const host = new URL(url).host;
    const wait = limiter?.delayFor(host) ?? 0;
    if (wait > 0) await sleep(Math.min(wait, 5_000));
    limiter?.tryTake(host);

    try {
      const response = await fetchImpl(url, {
        headers: { accept: "application/rdap+json, application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 429 || response.status === 403) {
        const retryAfter = Number(response.headers.get("retry-after") ?? 60);
        limiter?.backOff(host, Number.isFinite(retryAfter) ? retryAfter : 60);
        return {
          domain,
          source: "none",
          record: null,
          expiryUnavailable,
          error: `${host} is rate limiting us (${response.status})`,
        };
      }

      if (response.ok) {
        return {
          domain,
          source: "rdap",
          record: parseRdapDomain(await response.json()),
          expiryUnavailable,
          error: null,
        };
      }

      if (response.status === 404) {
        return {
          domain,
          source: "rdap",
          record: null,
          expiryUnavailable,
          error: "The registry has no record of this domain",
        };
      }
    } catch (error) {
      // Fall through to WHOIS rather than giving up on one bad response.
      void error;
    }
  }

  try {
    const text = await whoisQuery(whoisHostFor(tld), domain);
    if (text.trim() !== "") {
      return { domain, source: "whois", record: parseWhois(text), expiryUnavailable, error: null };
    }
  } catch (error) {
    return {
      domain,
      source: "none",
      record: null,
      expiryUnavailable,
      error: `No registry would answer for .${tld} (${(error as Error).message})`,
    };
  }

  return {
    domain,
    source: "none",
    record: null,
    expiryUnavailable,
    error: `No registry would answer for .${tld}`,
  };
}

/** A port 43 WHOIS query: send the name, read until the server hangs up. */
export function whoisQuery(host: string, domain: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.connect({ host, port: 43, timeout: WHOIS_TIMEOUT_MS });

    socket.once("connect", () => socket.write(`${domain}\r\n`));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      // Refuse to buffer an unbounded response from a hostile server.
      if (chunks.reduce((n, c) => n + c.length, 0) > 256 * 1024) {
        socket.destroy();
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    socket.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("WHOIS timed out"));
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reset the cached bootstrap file. For tests. */
export function clearBootstrapCache(): void {
  bootstrapCache = null;
}
