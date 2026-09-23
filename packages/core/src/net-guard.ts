/**
 * Outbound request guard.
 *
 * The monitor connects to hostnames that users type in. Without a guard, that
 * makes this service a tool for reaching things it should not: a database on
 * the loopback interface, a router on the local network, or a cloud
 * provider's metadata endpoint, which hands out credentials to anyone who can
 * make an HTTP request from inside the instance.
 *
 * The rule is: resolve the name first, then decide, and check every address
 * the name resolves to. Checking the hostname alone is not enough, because a
 * name under someone else's control can point wherever they like.
 */

export type BlockReason =
  | "loopback"
  | "private"
  | "link_local"
  | "cloud_metadata"
  | "unspecified"
  | "multicast"
  | "reserved"
  | "unparsable";

export interface AddressVerdict {
  readonly allowed: boolean;
  readonly reason?: BlockReason;
}

const ALLOWED: AddressVerdict = { allowed: true };

function block(reason: BlockReason): AddressVerdict {
  return { allowed: false, reason };
}

/** Ports the monitor is ever allowed to open. */
export const ALLOWED_PORTS: readonly number[] = [443, 43, 25, 465, 587, 993, 80];

export function isAllowedPort(port: number): boolean {
  return ALLOWED_PORTS.includes(port);
}

export function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function checkIpv4(value: string): AddressVerdict {
  const octets = parseIpv4(value);
  if (!octets) return block("unparsable");
  const [a = 0, b = 0, c = 0, d = 0] = octets;

  if (a === 0) return block("unspecified");
  if (a === 127) return block("loopback");
  if (a === 10) return block("private");
  if (a === 172 && b >= 16 && b <= 31) return block("private");
  if (a === 192 && b === 168) return block("private");
  // Carrier-grade NAT, 100.64.0.0/10
  if (a === 100 && b >= 64 && b <= 127) return block("private");
  // The cloud metadata address, reachable from inside most providers.
  if (a === 169 && b === 254 && c === 169 && d === 254) return block("cloud_metadata");
  if (a === 169 && b === 254) return block("link_local");
  // Documentation and benchmarking ranges, plus reserved space.
  if (a === 192 && b === 0 && c === 0) return block("reserved");
  if (a === 192 && b === 0 && c === 2) return block("reserved");
  if (a === 198 && (b === 18 || b === 19)) return block("reserved");
  if (a === 198 && b === 51 && c === 100) return block("reserved");
  if (a === 203 && b === 0 && c === 113) return block("reserved");
  if (a >= 224 && a <= 239) return block("multicast");
  if (a >= 240) return block("reserved");

  return ALLOWED;
}

function checkIpv6(value: string): AddressVerdict {
  const address = value.toLowerCase().split("%")[0] ?? "";

  // An IPv4-mapped address is an IPv4 address wearing a hat. Judge it as one.
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) return checkIpv4(mapped[1]);

  if (address === "::" ) return block("unspecified");
  if (address === "::1") return block("loopback");
  // Unique local addresses, fc00::/7
  if (/^f[cd]/.test(address)) return block("private");
  // Link local, fe80::/10
  if (/^fe[89ab]/.test(address)) return block("link_local");
  // Multicast, ff00::/8
  if (/^ff/.test(address)) return block("multicast");
  // The IPv6 metadata address used by several cloud providers.
  if (address === "fd00:ec2::254") return block("cloud_metadata");
  if (!address.includes(":")) return block("unparsable");

  return ALLOWED;
}

/** Judge a resolved IP address. Names are never judged directly. */
export function checkAddress(value: string): AddressVerdict {
  const trimmed = value.trim();
  if (trimmed === "") return block("unparsable");
  return trimmed.includes(":") ? checkIpv6(trimmed) : checkIpv4(trimmed);
}

/** True only when every address the name resolved to is safe to reach. */
export function allAddressesAllowed(addresses: readonly string[]): AddressVerdict {
  if (addresses.length === 0) return block("unparsable");
  for (const address of addresses) {
    const verdict = checkAddress(address);
    if (!verdict.allowed) return verdict;
  }
  return ALLOWED;
}

export function explainBlock(reason: BlockReason): string {
  switch (reason) {
    case "loopback": return "that address is this machine itself";
    case "private": return "that address is on a private network";
    case "link_local": return "that address is link-local";
    case "cloud_metadata": return "that address is a cloud metadata endpoint";
    case "unspecified": return "that address is unspecified";
    case "multicast": return "that address is multicast";
    case "reserved": return "that address is reserved";
    case "unparsable": return "that address could not be read";
  }
}

/** A hostname is acceptable in shape. Whether it is reachable is decided after DNS. */
export function isPlausibleHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  // Names reserved for local resolution should never be monitored.
  if (/\.(local|internal|home|lan|intranet|corp)$/i.test(host)) return false;
  return host
    .split(".")
    .every((part) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
}
