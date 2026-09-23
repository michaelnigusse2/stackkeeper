import { formatMoney, type Money } from "@stackkeeper/core";

export function money(value: Money, locale = "en-US"): string {
  return formatMoney(value, locale);
}

/** A signed figure, so a loss reads as a loss at a glance. */
export function signedMoney(value: Money, locale = "en-US"): string {
  const formatted = formatMoney(value, locale);
  return value.amount > 0 ? `+${formatted}` : formatted;
}

export function percent(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${Math.round(ratio * 100)}%`;
}

export function date(value: Date | string | null): string {
  if (!value) return "—";
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toISOString().slice(0, 10);
}

/**
 * Whole days from now until a date, negative once it has passed.
 *
 * Accepts a Date or a string because Postgres `date` and `timestamptz` columns
 * arrive as Date objects through the driver while JSON payloads carry strings,
 * and a caller should not have to know which it has. Comparing the two shapes
 * directly is how a cancelled cost line once went on counting toward margin
 * for ever, so both are normalised here instead.
 */
export function daysUntil(value: Date | string | null): number | null {
  if (!value) return null;
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) return null;
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(parsed) - startOfDay(new Date())) / 86_400_000);
}

/** "4d", "31d", "12d ago" — the short form, for a narrow leading column. */
export function shortDays(value: Date | string | null): string {
  const days = daysUntil(value);
  if (days === null) return "—";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "today";
  return `${days}d`;
}

/** "in 12 days", "today", "8 days ago" — relative to now, in whole days. */
export function relativeDays(value: Date | string | null): string {
  if (!value) return "—";
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) return "—";
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((startOfDay(parsed) - startOfDay(new Date())) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

export const PARTY_LABELS: Readonly<Record<string, string>> = {
  agency: "You",
  client: "The client",
  third_party: "A third party",
  unknown: "Not recorded",
};

export const KIND_LABELS: Readonly<Record<string, string>> = {
  server: "Server",
  domain: "Domain",
  certificate: "Certificate",
  hosting: "Hosting",
  dns: "DNS",
  email: "Email",
  saas: "SaaS",
  license: "Licence",
  cdn: "CDN",
  database: "Database",
  storage: "Storage",
  other: "Other",
};
