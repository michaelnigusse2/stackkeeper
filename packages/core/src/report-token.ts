/**
 * Client report link tokens: 32 random bytes, base64url without padding,
 * which is always 43 characters. Anything else is rejected before a lookup,
 * so a malformed URL never reaches the database.
 */
export const REPORT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isReportToken(value: unknown): value is string {
  return typeof value === "string" && REPORT_TOKEN_PATTERN.test(value);
}

/** How long a new link may live, in days. Links always expire. */
export const REPORT_LINK_DAYS = [7, 30, 90] as const;
export type ReportLinkDays = (typeof REPORT_LINK_DAYS)[number];
