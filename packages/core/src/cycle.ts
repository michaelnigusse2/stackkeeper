/**
 * Billing cycles, and normalising them to a monthly run rate.
 *
 * Every margin figure in the product is "per month", because that is the unit
 * a freelancer thinks in when deciding what to invoice. A domain billed once a
 * year and a server billed monthly have to be comparable.
 */

import type { ExactMinor, Money } from "./money.ts";
import { exponentOf } from "./money.ts";

export const BILLING_CYCLES = [
  "once",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "biennial",
  "triennial",
] as const;

export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Months covered by one payment. `once` is not recurring, so it has none. */
const MONTHS_PER_CYCLE: Readonly<Record<BillingCycle, number | null>> = {
  once: null,
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
  biennial: 24,
  triennial: 36,
};

export function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === "string" && (BILLING_CYCLES as readonly string[]).includes(value);
}

export function monthsPerCycle(cycle: BillingCycle): number | null {
  return MONTHS_PER_CYCLE[cycle];
}

export function isRecurring(cycle: BillingCycle): boolean {
  return MONTHS_PER_CYCLE[cycle] !== null;
}

/**
 * Monthly run rate of an amount, in fractional minor units.
 *
 * A one-off payment contributes nothing to a monthly rate, so it returns 0.
 * One-off costs are still shown in their own total; they are simply not part
 * of "what this client costs me every month".
 */
export function monthlyExact(value: Money, cycle: BillingCycle): ExactMinor {
  const months = MONTHS_PER_CYCLE[cycle];
  if (months === null) return 0;
  return value.amount / months;
}

/** Yearly run rate, in fractional minor units. */
export function yearlyExact(value: Money, cycle: BillingCycle): ExactMinor {
  return monthlyExact(value, cycle) * 12;
}

export function cycleLabel(cycle: BillingCycle): string {
  switch (cycle) {
    case "once":
      return "one-off";
    case "monthly":
      return "per month";
    case "quarterly":
      return "per quarter";
    case "semiannual":
      return "twice a year";
    case "annual":
      return "per year";
    case "biennial":
      return "every two years";
    case "triennial":
      return "every three years";
  }
}

/**
 * The next renewal on or after `from`, given a known previous renewal date.
 * Returns null for one-off charges. Dates are handled in UTC so that a
 * renewal never shifts a day because of the viewer's time zone.
 */
export function nextRenewalAfter(
  previousRenewal: Date,
  cycle: BillingCycle,
  from: Date,
): Date | null {
  const months = MONTHS_PER_CYCLE[cycle];
  if (months === null) return null;

  const next = new Date(previousRenewal.getTime());
  let guard = 0;
  while (next.getTime() <= from.getTime()) {
    addMonthsUtc(next, months);
    if (++guard > 1000) {
      throw new Error("Could not find the next renewal date within 1000 cycles");
    }
  }
  return next;
}

/**
 * Add whole months in UTC, clamping the day of month so that 31 January plus
 * one month is 28 or 29 February rather than rolling into March.
 */
function addMonthsUtc(date: Date, months: number): void {
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
}

/** Whole days between two instants, counted in UTC calendar days. */
export function daysBetween(from: Date, to: Date): number {
  const startOfDay = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

/** Human amount for display, for example 12.5 for 1250 minor units of USD. */
export function toMajorUnits(value: Money): number {
  return value.amount / 10 ** exponentOf(value.currency);
}
