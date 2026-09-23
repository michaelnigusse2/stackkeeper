/**
 * Job names and payload shapes.
 *
 * The queue is Postgres, through pg-boss, so there is no second piece of
 * infrastructure to run, back up or explain to a self-hoster. At the scale
 * this product needs, fifty thousand checks a day is under one per second,
 * which a single worker handles comfortably.
 */

export const JOBS = {
  /** Fan out: find monitors that are due and queue one check for each. */
  scheduleDueChecks: "monitors.schedule-due",
  /** One TLS handshake for one target. */
  checkTls: "monitors.check-tls",
  /** One RDAP or WHOIS lookup for one domain. */
  checkDomain: "monitors.check-domain",
  /** Evaluate alert rules after a check result lands. */
  evaluateAlerts: "alerts.evaluate",
  /** Deliver an alert over email or a webhook. */
  deliverAlert: "alerts.deliver",
  /** Refresh exchange rates so margins stay correct. */
  refreshRates: "fx.refresh",
  /** Erase soft-deleted records past their retention window. */
  purgeDeleted: "maintenance.purge",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface CheckJob {
  readonly monitorId: string;
  readonly orgId: string;
  readonly target: string;
}

export interface AlertJob {
  readonly alertId: string;
  readonly orgId: string;
}

/**
 * How often each monitor kind is checked.
 *
 * Certificates are checked hourly because Let's Encrypt now issues
 * certificates that live six days, and a daily check could miss a failed
 * renewal entirely. Domains are checked daily, because registry data changes
 * slowly and registries rate-limit hard, tightening to every six hours inside
 * the last fortnight before expiry.
 */
export const CHECK_INTERVALS = {
  tls: { normal: 60 * 60 * 1000, urgent: 15 * 60 * 1000 },
  domain: { normal: 24 * 60 * 60 * 1000, urgent: 6 * 60 * 60 * 1000 },
  dns: { normal: 24 * 60 * 60 * 1000, urgent: 6 * 60 * 60 * 1000 },
} as const;

/** Days before expiry at which a domain moves to the urgent cadence. */
export const URGENT_WINDOW_DAYS = 14;
