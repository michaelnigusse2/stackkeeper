/**
 * Renewal reminders.
 *
 * The monitors watch what can be looked up from outside: domain registrations
 * and certificates. Everything else renews on a date only the user knows: a
 * hosting plan, a licence, a SaaS seat, the next payment on a cost line. This
 * turns those dates into alerts at 30, 14 and 3 days out, and once more when
 * the date has passed without being moved forward.
 *
 * Each stage alerts once. The dedupe key carries the date and the stage, so
 * acknowledging a reminder sticks until the next stage, and moving the date
 * (because the thing renewed) retires the old reminders by themselves.
 */

import { daysBetween } from "./cycle.ts";
import { toDayString } from "./margin.ts";

export type RenewalStage = "due_30" | "due_14" | "due_3" | "overdue";
export type RenewalSeverity = "info" | "warning" | "critical";

/** Which reminder applies `days` before the date; null when it is too far off. */
export function renewalStage(days: number): RenewalStage | null {
  if (days < 0) return "overdue";
  if (days <= 3) return "due_3";
  if (days <= 14) return "due_14";
  if (days <= 30) return "due_30";
  return null;
}

const STAGE_SEVERITY: Readonly<Record<RenewalStage, RenewalSeverity>> = {
  due_30: "warning",
  due_14: "warning",
  due_3: "critical",
  // Usually it renewed and the date was never moved on; sometimes it lapsed.
  // Either way a person has to look, but it is not an outage by itself.
  overdue: "warning",
};

export interface RenewalSubject {
  /** A cost line's next payment, or an asset's own renewal or expiry date. */
  readonly source: "cost_line" | "asset";
  readonly id: string;
  readonly orgId: string;
  readonly assetId: string;
  readonly assetLabel: string;
  readonly clientName?: string | null;
  readonly dueOn: string | Date | null;
  /** For cost lines: "USD 12.00 per year", shown in the message. */
  readonly amountText?: string | null;
  /** For cost lines: false when the client is not charged for it. */
  readonly charged?: boolean | null;
}

export interface RenewalAlert {
  readonly orgId: string;
  readonly assetId: string;
  readonly rule: `renewal_${RenewalStage}`;
  readonly severity: RenewalSeverity;
  readonly dedupeKey: string;
  readonly message: string;
  readonly dueOn: string;
  readonly source: RenewalSubject["source"];
  readonly sourceId: string;
}

/** Every renewal alert key starts with this, so stale ones can be found. */
export const RENEWAL_KEY_PREFIX = "renewal:";

function inDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function messageFor(subject: RenewalSubject, dueOn: string, days: number): string {
  const what = subject.assetLabel;
  const amount = subject.amountText ? ` (${subject.amountText})` : "";
  const uncharged =
    subject.source === "cost_line" && subject.charged === false
      ? " The client is not charged for it."
      : "";

  if (days < 0) {
    const ago = -days === 1 ? "yesterday" : `${-days} days ago`;
    return subject.source === "cost_line"
      ? `The renewal recorded for ${what} was ${ago}, on ${dueOn}${amount}. If it renewed, move the date on to the next renewal; if not, check it has not lapsed.${uncharged}`
      : `${what} was due to renew or expire ${ago}, on ${dueOn}. If it renewed, record the new date; if not, check it has not lapsed.`;
  }

  return subject.source === "cost_line"
    ? `${what} renews ${inDays(days)}, on ${dueOn}${amount}.${uncharged}`
    : `${what} is due to renew or expire ${inDays(days)}, on ${dueOn}.`;
}

/** The reminder due today for one dated subject, or null. */
export function evaluateRenewal(subject: RenewalSubject, now: Date = new Date()): RenewalAlert | null {
  const dueOn = toDayString(subject.dueOn);
  if (dueOn === null) return null;
  const days = daysBetween(now, new Date(`${dueOn}T00:00:00Z`));
  const stage = renewalStage(days);
  if (stage === null) return null;
  return {
    orgId: subject.orgId,
    assetId: subject.assetId,
    rule: `renewal_${stage}`,
    severity: STAGE_SEVERITY[stage],
    dedupeKey: `${RENEWAL_KEY_PREFIX}${subject.source}:${subject.id}:${dueOn}:${stage}`,
    message: messageFor(subject, dueOn, days),
    dueOn,
    source: subject.source,
    sourceId: subject.id,
  };
}

export function evaluateRenewals(
  subjects: readonly RenewalSubject[],
  now: Date = new Date(),
): RenewalAlert[] {
  const alerts: RenewalAlert[] = [];
  for (const subject of subjects) {
    const alert = evaluateRenewal(subject, now);
    if (alert) alerts.push(alert);
  }
  return alerts;
}
