/**
 * Reading a TLS certificate.
 *
 * The values here come from Node's TLS peer certificate, but nothing in this
 * file touches a socket, so every rule below is testable: the date formats
 * OpenSSL emits, wildcard matching, and what counts as covering a hostname.
 */

export interface PeerCertificateLike {
  subject?: { CN?: string } | undefined;
  issuer?: { CN?: string; O?: string } | undefined;
  valid_from?: string | undefined;
  valid_to?: string | undefined;
  fingerprint256?: string | undefined;
  serialNumber?: string | undefined;
  subjectaltname?: string | undefined;
}

export interface CertificateSummary {
  readonly notBefore: Date | null;
  readonly notAfter: Date | null;
  readonly issuer: string;
  readonly subject: string | null;
  readonly serialNumber: string | null;
  readonly fingerprint: string | null;
  readonly sans: readonly string[];
  /** Total validity in days, which decides whether relative alerts apply. */
  readonly lifetimeDays: number | null;
}

/**
 * OpenSSL prints dates as "Sep  1 00:00:00 2026 GMT", with a padding space for
 * single-digit days that `Date` on its own reads inconsistently.
 */
export function parseCertificateDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value.replace(/\s+/g, " ").trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "DNS:example.com, DNS:*.example.com, IP Address:1.2.3.4" into a list. */
export function parseSubjectAltNames(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .map((entry) => {
      const separator = entry.indexOf(":");
      return separator === -1 ? entry : entry.slice(separator + 1).trim();
    })
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
}

/**
 * Does one certificate name cover this host?
 *
 * A wildcard matches exactly one label, and only the leftmost one, so
 * `*.example.com` covers `www.example.com` but neither `example.com` itself
 * nor `a.b.example.com`. Treating a wildcard as covering the bare domain is a
 * common mistake and would hide a genuine mismatch.
 */
export function nameCoversHost(name: string, host: string): boolean {
  const pattern = name.trim().toLowerCase().replace(/\.$/, "");
  const target = host.trim().toLowerCase().replace(/\.$/, "");
  if (pattern === "" || target === "") return false;
  if (pattern === target) return true;
  if (!pattern.startsWith("*.")) return false;

  const suffix = pattern.slice(2);
  if (suffix === "" || !target.endsWith(`.${suffix}`)) return false;

  const label = target.slice(0, target.length - suffix.length - 1);
  return label !== "" && !label.includes(".");
}

/** True when any name on the certificate covers the host that was asked for. */
export function certificateCoversHost(
  summary: Pick<CertificateSummary, "sans" | "subject">,
  host: string,
): boolean {
  if (summary.sans.some((name) => nameCoversHost(name, host))) return true;
  // Falling back to the common name is for certificates old enough to omit
  // subject alternative names; browsers stopped accepting it years ago.
  return summary.subject ? nameCoversHost(summary.subject, host) : false;
}

export function issuerName(certificate: PeerCertificateLike): string {
  const issuer = certificate.issuer;
  const organisation = issuer?.O?.trim();
  const common = issuer?.CN?.trim();
  if (organisation && common && organisation !== common) return `${organisation} ${common}`;
  return organisation || common || "unknown issuer";
}

export function summariseCertificate(certificate: PeerCertificateLike): CertificateSummary {
  const notBefore = parseCertificateDate(certificate.valid_from);
  const notAfter = parseCertificateDate(certificate.valid_to);

  const lifetimeDays =
    notBefore && notAfter
      ? Math.round((notAfter.getTime() - notBefore.getTime()) / 86_400_000)
      : null;

  return {
    notBefore,
    notAfter,
    issuer: issuerName(certificate),
    subject: certificate.subject?.CN?.toLowerCase() ?? null,
    serialNumber: certificate.serialNumber ?? null,
    fingerprint: certificate.fingerprint256 ?? null,
    sans: parseSubjectAltNames(certificate.subjectaltname),
    lifetimeDays,
  };
}

/**
 * Share of the certificate's life that has elapsed.
 *
 * This is the number the alert rules work from. Maximum certificate validity
 * falls to 100 days in March 2027 and 47 days in March 2029, and Let's Encrypt
 * already issues six-day certificates, so "days remaining" stopped being a
 * useful signal: a healthy short certificate is always near its expiry date.
 * What distinguishes a healthy one is that it gets replaced partway through.
 */
export function lifetimeElapsed(
  summary: Pick<CertificateSummary, "notBefore" | "notAfter">,
  now: Date = new Date(),
): number | null {
  if (!summary.notBefore || !summary.notAfter) return null;
  const total = summary.notAfter.getTime() - summary.notBefore.getTime();
  if (total <= 0) return 1;
  return (now.getTime() - summary.notBefore.getTime()) / total;
}

/** Whole days until expiry; negative once it has passed. */
export function daysUntilExpiry(
  summary: Pick<CertificateSummary, "notAfter">,
  now: Date = new Date(),
): number | null {
  if (!summary.notAfter) return null;
  return Math.floor((summary.notAfter.getTime() - now.getTime()) / 86_400_000);
}
