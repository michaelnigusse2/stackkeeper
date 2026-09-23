/**
 * Working out which name to actually look up.
 *
 * A registration exists for the registrable domain, one level below a public
 * suffix: `example.co.uk`, not `www.example.co.uk` and not `co.uk`. Getting
 * this wrong means querying a registry for a name it has never heard of.
 *
 * The authoritative answer is the Public Suffix List, which is about 200 KB
 * and changes weekly. Rather than vendor a stale copy, this carries the
 * multi-level suffixes that actually appear in a web agency's client list, and
 * treats everything else as a single-label suffix. Where that guess is wrong
 * the lookup fails loudly rather than silently reporting the wrong domain.
 */

/** Suffixes where the registrable name sits two labels below the TLD. */
const MULTI_LEVEL_SUFFIXES = new Set([
  // United Kingdom
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk", "ac.uk", "gov.uk",
  // Australia and New Zealand
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz",
  // Africa
  "co.za", "org.za", "net.za", "web.za", "gov.za", "ac.za",
  "co.ke", "or.ke", "ne.ke", "go.ke", "ac.ke",
  "com.ng", "org.ng", "net.ng", "gov.ng", "edu.ng",
  "com.et", "org.et", "net.et", "gov.et", "edu.et",
  "com.gh", "com.eg", "co.tz", "co.ug",
  // Asia
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "co.in", "net.in", "org.in", "gen.in", "firm.in", "ind.in",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "com.sg", "com.my", "com.hk", "com.tw", "co.kr", "co.th", "co.id", "com.ph",
  // Europe
  "co.at", "or.at", "com.es", "org.es", "nom.es", "com.pl", "net.pl", "org.pl",
  "com.tr", "com.ua", "com.ro", "com.hr", "com.pt", "com.gr", "co.il",
  // Americas
  "com.br", "net.br", "org.br", "com.mx", "com.ar", "com.co", "com.pe", "com.ve",
  // Widely used hosting suffixes, where each label is a separate site
  "github.io", "gitlab.io", "pages.dev", "workers.dev", "vercel.app", "netlify.app",
  "herokuapp.com", "azurewebsites.net", "cloudfront.net", "s3.amazonaws.com",
  "web.app", "firebaseapp.com", "myshopify.com", "wordpress.com", "blogspot.com",
]);

export class DomainNameError extends Error {}

/** Strip scheme, port, path, trailing dot and case from anything host-shaped. */
export function normaliseHost(input: string): string {
  let host = input.trim().toLowerCase();
  if (host === "") throw new DomainNameError("An empty value is not a hostname");

  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      throw new DomainNameError(`Could not read a hostname from ${input}`);
    }
  }
  host = host.split("/")[0] ?? "";
  // Strip a port, but leave a bracketed IPv6 literal alone.
  if (!host.startsWith("[")) host = host.split(":")[0] ?? "";
  host = host.replace(/\.$/, "");

  if (host === "") throw new DomainNameError(`Could not read a hostname from ${input}`);
  return host;
}

/** True for a bare IP address, which has no registration to look up. */
export function isIpAddress(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":") || /^\[.*\]$/.test(host);
}

/**
 * The name a registry would know: one label below the public suffix.
 * Returns null for an IP address or a bare suffix, neither of which is a
 * registration.
 */
export function registrableDomain(input: string): string | null {
  const host = normaliseHost(input);
  if (isIpAddress(host)) return null;

  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return null;

  const lastTwo = labels.slice(-2).join(".");
  const lastThree = labels.slice(-3).join(".");

  if (labels.length >= 3 && MULTI_LEVEL_SUFFIXES.has(lastTwo)) {
    return lastThree;
  }
  if (MULTI_LEVEL_SUFFIXES.has(lastTwo)) {
    // The name is itself a public suffix, so nobody registered it.
    return null;
  }
  return lastTwo;
}

/** The top-level domain, lower case, without a leading dot. */
export function topLevelDomain(input: string): string | null {
  const host = normaliseHost(input);
  if (isIpAddress(host)) return null;
  const labels = host.split(".").filter(Boolean);
  const tld = labels[labels.length - 1];
  return tld && labels.length >= 2 ? tld : null;
}

/**
 * Convert an internationalised name to the ASCII form registries expect.
 * Node's URL parser does the punycode conversion, so no dependency is needed.
 */
export function toAscii(input: string): string {
  const host = normaliseHost(input);
  try {
    return new URL(`https://${host}`).hostname;
  } catch {
    throw new DomainNameError(`Could not convert ${input} to its ASCII form`);
  }
}

/** True when the name contains characters outside the ASCII form. */
export function isInternationalised(input: string): boolean {
  const host = normaliseHost(input);
  return toAscii(host) !== host;
}
