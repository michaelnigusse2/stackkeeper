/**
 * Reading registration data.
 *
 * ICANN made RDAP the definitive source for generic top-level domains on
 * 28 January 2025 and sunset WHOIS for them, so RDAP is tried first and port
 * 43 WHOIS is the fallback. Roughly 40% of country-code registries still have
 * no RDAP service at all, and a few that do publish no expiry date, so a date
 * entered by hand is a first-class part of the model rather than a fallback.
 *
 * Everything here is pure: it turns bytes that came back from a registry into
 * a normalised record, and can be tested without a network.
 */

export interface RdapEvent {
  readonly action: string;
  readonly date: string;
}

export interface RdapDomain {
  readonly domain: string | null;
  readonly expiresAt: Date | null;
  readonly registeredAt: Date | null;
  readonly lastChangedAt: Date | null;
  /** Registry statuses, as published. Compare with `normaliseStatus`. */
  readonly statuses: readonly string[];
  readonly nameservers: readonly string[];
  readonly registrar: string | null;
  readonly dnssec: boolean;
  readonly events: readonly RdapEvent[];
}

export class RdapError extends Error {}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * RDAP writes statuses with spaces ("client transfer prohibited") while EPP
 * and most documentation use camel case ("clientTransferProhibited"). Compare
 * the squashed lower-case form so both spellings match.
 */
export function normaliseStatus(status: string): string {
  return status.toLowerCase().replace(/[\s_-]+/g, "");
}

export function hasStatus(statuses: readonly string[], wanted: string): boolean {
  const target = normaliseStatus(wanted);
  return statuses.some((s) => normaliseStatus(s) === target);
}

/** The registrar's name, dug out of the vCard on the entity holding that role. */
function findRegistrar(entities: unknown[]): string | null {
  for (const entity of entities) {
    if (typeof entity !== "object" || entity === null) continue;
    const record = entity as Record<string, unknown>;
    const roles = asArray(record.roles).map((r) => String(r).toLowerCase());
    if (!roles.includes("registrar")) continue;

    // vcardArray is ["vcard", [["version",{},"text","4.0"], ["fn",{},"text","Name"], ...]]
    const vcard = asArray(record.vcardArray)[1];
    for (const field of asArray(vcard)) {
      const parts = asArray(field);
      if (String(parts[0]).toLowerCase() === "fn" && typeof parts[3] === "string") {
        return parts[3];
      }
    }
    if (typeof record.handle === "string") return record.handle;
  }
  return null;
}

/** Turn an RDAP domain response into a normalised record. */
export function parseRdapDomain(payload: unknown): RdapDomain {
  if (typeof payload !== "object" || payload === null) {
    throw new RdapError("The registry did not return a JSON object");
  }
  const record = payload as Record<string, unknown>;

  const events: RdapEvent[] = [];
  for (const raw of asArray(record.events)) {
    if (typeof raw !== "object" || raw === null) continue;
    const event = raw as Record<string, unknown>;
    if (typeof event.eventAction === "string" && typeof event.eventDate === "string") {
      events.push({ action: event.eventAction, date: event.eventDate });
    }
  }

  const dateFor = (action: string): Date | null => {
    const match = events.find((e) => normaliseStatus(e.action) === normaliseStatus(action));
    return match ? asDate(match.date) : null;
  };

  const nameservers = asArray(record.nameservers)
    .map((ns) => {
      if (typeof ns !== "object" || ns === null) return null;
      const value = (ns as Record<string, unknown>).ldhName;
      return typeof value === "string" ? value.toLowerCase() : null;
    })
    .filter((ns): ns is string => ns !== null);

  const secureDns = record.secureDNS;
  const dnssec =
    typeof secureDns === "object" &&
    secureDns !== null &&
    (secureDns as Record<string, unknown>).delegationSigned === true;

  return {
    domain: typeof record.ldhName === "string" ? record.ldhName.toLowerCase() : null,
    // Some registries publish the registrar's copy of the date separately.
    expiresAt: dateFor("expiration") ?? dateFor("registrar expiration"),
    registeredAt: dateFor("registration"),
    lastChangedAt: dateFor("last changed"),
    statuses: asArray(record.status).map(String),
    nameservers,
    registrar: findRegistrar(asArray(record.entities)),
    dnssec,
    events,
  };
}

// ---------------------------------------------------------------------------
// Finding the right registry
// ---------------------------------------------------------------------------

export interface BootstrapFile {
  readonly services: readonly (readonly [readonly string[], readonly string[]])[];
  readonly publication?: string;
}

/**
 * Registries running RDAP without registering it in the IANA bootstrap file.
 * Querying rdap.org for these returns 404, so they are held here.
 *
 * DENIC describes its service as test operation with no service level, and
 * publishes no expiry date, so .de still needs a date entered by hand.
 */
export const EXTRA_RDAP_SERVERS: Readonly<Record<string, string>> = {
  de: "https://rdap.denic.de/",
  io: "https://rdap.identitydigital.services/rdap/",
  sh: "https://rdap.identitydigital.services/rdap/",
  ac: "https://rdap.identitydigital.services/rdap/",
  me: "https://rdap.identitydigital.services/rdap/",
};

/** Registries that publish no expiry date, so one must be entered by hand. */
export const NO_PUBLISHED_EXPIRY = new Set(["de", "nl", "ch", "li", "eu"]);

export function publishesExpiry(tld: string): boolean {
  return !NO_PUBLISHED_EXPIRY.has(tld.toLowerCase());
}

/** The RDAP base URL for a top-level domain, or null if there is none. */
export function findRdapBase(bootstrap: BootstrapFile | null, tld: string): string | null {
  const target = tld.toLowerCase();

  for (const service of bootstrap?.services ?? []) {
    const [tlds, urls] = service;
    if (!tlds?.some((entry) => entry.toLowerCase() === target)) continue;
    // Prefer HTTPS; some entries list plain HTTP first.
    const https = urls?.find((url) => url.startsWith("https://"));
    const chosen = https ?? urls?.[0];
    if (chosen) return chosen.endsWith("/") ? chosen : `${chosen}/`;
  }

  const extra = EXTRA_RDAP_SERVERS[target];
  return extra ?? null;
}

/** The full URL to query for one domain, or null when no registry is known. */
export function rdapUrlFor(domain: string, bootstrap: BootstrapFile | null): string | null {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  const tld = labels[labels.length - 1];
  if (!tld) return null;

  const base = findRdapBase(bootstrap, tld);
  if (!base) return null;
  return `${base}domain/${encodeURIComponent(domain.toLowerCase())}`;
}

// ---------------------------------------------------------------------------
// WHOIS, for the registries RDAP has not reached
// ---------------------------------------------------------------------------

const WHOIS_EXPIRY_LABELS = [
  "registry expiry date",
  "registrar registration expiration date",
  "expiration date",
  "expiry date",
  "expires on",
  "expires",
  "paid-till",
  "renewal date",
  "valid until",
];

const WHOIS_STATUS_LABELS = ["domain status", "status", "state"];
const WHOIS_NAMESERVER_LABELS = ["name server", "nserver", "nameserver"];
const WHOIS_REGISTRAR_LABELS = ["registrar", "sponsoring registrar"];

function whoisField(text: string, labels: readonly string[]): string[] {
  const found: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (value !== "" && labels.includes(key)) found.push(value);
  }
  return found;
}

/**
 * Pull what we need out of a port 43 WHOIS response.
 *
 * WHOIS has no schema, so this reads the labels registries actually use and
 * returns nulls rather than guessing. A missing date is reported as unknown,
 * never inferred.
 */
export function parseWhois(text: string): RdapDomain {
  const expiryText = whoisField(text, WHOIS_EXPIRY_LABELS)[0];
  const expiresAt = expiryText ? asDate(expiryText) : null;

  const statuses = whoisField(text, WHOIS_STATUS_LABELS)
    // "clientTransferProhibited https://icann.org/epp#..." — keep the code.
    .map((value) => value.split(/\s+/)[0] ?? value)
    .filter(Boolean);

  return {
    domain: null,
    expiresAt,
    registeredAt: null,
    lastChangedAt: null,
    statuses,
    nameservers: whoisField(text, WHOIS_NAMESERVER_LABELS).map((ns) =>
      (ns.split(/\s+/)[0] ?? ns).toLowerCase(),
    ),
    registrar: whoisField(text, WHOIS_REGISTRAR_LABELS)[0] ?? null,
    dnssec: false,
    events: [],
  };
}

/** The WHOIS host for a top-level domain, from the IANA convention. */
export function whoisHostFor(tld: string): string {
  return `${tld.toLowerCase()}.whois-servers.net`;
}
