/**
 * Margin and unbilled-service calculations.
 *
 * This is the product's reason to exist: showing a freelancer what their
 * clients' infrastructure costs them, what those clients are charged, and
 * which services are being paid for and never invoiced.
 *
 * Two rules shape the implementation:
 *   1. Everything is converted to one reporting currency and summed in exact
 *      fractional minor units, then rounded once at the end.
 *   2. A line that cannot be converted is never silently counted as zero. It
 *      is excluded and reported, so a total is either right or visibly
 *      incomplete. Quietly understating what a client costs would undermine
 *      the one number the user is here for.
 */

import type { BillingCycle } from "./cycle.ts";
import { monthlyExact } from "./cycle.ts";
import type { ExactMinor, Money } from "./money.ts";
import { money, toMoney } from "./money.ts";
import type { RateTable } from "./fx.ts";
import { convertExact, FxError } from "./fx.ts";

export interface CostLineLike {
  readonly id: string;
  readonly assetId: string;
  readonly costAmount: number;
  readonly costCurrency: string;
  readonly costCycle: BillingCycle;
  readonly chargeAmount: number | null;
  readonly chargeCurrency: string | null;
  readonly chargeCycle: BillingCycle | null;
  readonly billed: boolean;
  /**
   * A calendar day, as an ISO string or a Date. Both are accepted because a
   * Postgres `date` column arrives as a Date through the driver while the
   * same value arrives as a string from a form or a CSV, and comparing the
   * two shapes with `<` silently yields false for every row.
   */
  readonly endedOn?: string | Date | null;
  readonly startedOn?: string | Date | null;
}

export type MarginFlagCode =
  | "no_charge"
  | "not_invoiced"
  | "below_cost"
  | "charge_equals_cost"
  | "missing_rate";

export type FlagSeverity = "info" | "warning" | "critical";

export interface MarginFlag {
  readonly code: MarginFlagCode;
  readonly severity: FlagSeverity;
  readonly message: string;
}

export interface LineMargin {
  readonly lineId: string;
  readonly assetId: string;
  readonly monthlyCost: Money;
  readonly monthlyCharge: Money;
  readonly monthlyMargin: Money;
  /** Margin as a share of the charge, or null when nothing is charged. */
  readonly marginRatio: number | null;
  readonly flags: readonly MarginFlag[];
  /** False when a missing exchange rate kept this line out of the totals. */
  readonly counted: boolean;
}

export interface MarginRollup {
  readonly currency: string;
  readonly monthlyCost: Money;
  readonly monthlyCharge: Money;
  readonly monthlyMargin: Money;
  readonly yearlyMargin: Money;
  readonly marginRatio: number | null;
  readonly lines: readonly LineMargin[];
  /** Lines left out of the totals because no exchange rate was available. */
  readonly uncountedLineIds: readonly string[];
  /** True when at least one line could not be counted. Show a warning. */
  readonly incomplete: boolean;
  readonly flagCounts: Readonly<Record<MarginFlagCode, number>>;
}

const FLAG_TEXT: Readonly<Record<MarginFlagCode, { severity: FlagSeverity; message: string }>> = {
  no_charge: {
    severity: "critical",
    message: "You pay for this and the client is not charged for it.",
  },
  not_invoiced: {
    severity: "warning",
    message: "A charge is recorded but has not been marked as invoiced.",
  },
  below_cost: {
    severity: "critical",
    message: "The client is charged less than this costs you.",
  },
  charge_equals_cost: {
    severity: "info",
    message: "This is passed through at cost, with no margin.",
  },
  missing_rate: {
    severity: "warning",
    message: "No exchange rate was available, so this line is not in the totals.",
  },
};

function flag(code: MarginFlagCode): MarginFlag {
  return { code, ...FLAG_TEXT[code] };
}

/**
 * The calendar day of a value that may be a Date or an ISO string.
 * Returns null for anything unreadable, which callers treat as "no limit"
 * rather than guessing a date.
 */
export function toDayString(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** A line counts if it has started and has not ended by the as-of date. */
export function isLineActive(line: CostLineLike, asOf: Date = new Date()): boolean {
  const day = asOf.toISOString().slice(0, 10);
  const startedOn = toDayString(line.startedOn);
  const endedOn = toDayString(line.endedOn);
  if (startedOn && startedOn > day) return false;
  if (endedOn && endedOn < day) return false;
  return true;
}

/**
 * Margin for a single cost line, expressed in the reporting currency.
 */
export function lineMargin(
  line: CostLineLike,
  reportingCurrency: string,
  rates: RateTable,
): LineMargin {
  const flags: MarginFlag[] = [];
  let counted = true;

  let costExact: ExactMinor = 0;
  try {
    costExact = convertExact(
      monthlyExact(money(line.costAmount, line.costCurrency), line.costCycle),
      line.costCurrency,
      reportingCurrency,
      rates,
    );
  } catch (error) {
    if (!(error instanceof FxError)) throw error;
    flags.push(flag("missing_rate"));
    counted = false;
  }

  let chargeExact: ExactMinor = 0;
  const hasCharge =
    line.chargeAmount !== null && line.chargeCurrency !== null && line.chargeCycle !== null;

  if (hasCharge) {
    try {
      chargeExact = convertExact(
        monthlyExact(
          money(line.chargeAmount as number, line.chargeCurrency as string),
          line.chargeCycle as BillingCycle,
        ),
        line.chargeCurrency as string,
        reportingCurrency,
        rates,
      );
    } catch (error) {
      if (!(error instanceof FxError)) throw error;
      if (!flags.some((f) => f.code === "missing_rate")) flags.push(flag("missing_rate"));
      counted = false;
    }
  } else {
    flags.push(flag("no_charge"));
  }

  if (hasCharge && !line.billed) flags.push(flag("not_invoiced"));

  if (counted && hasCharge) {
    if (chargeExact < costExact) flags.push(flag("below_cost"));
    else if (chargeExact === costExact && costExact > 0) flags.push(flag("charge_equals_cost"));
  }

  const marginExact = chargeExact - costExact;

  return {
    lineId: line.id,
    assetId: line.assetId,
    monthlyCost: toMoney(costExact, reportingCurrency),
    monthlyCharge: toMoney(chargeExact, reportingCurrency),
    monthlyMargin: toMoney(marginExact, reportingCurrency),
    marginRatio: chargeExact > 0 ? marginExact / chargeExact : null,
    flags,
    counted,
  };
}

/**
 * Roll a set of cost lines up into one margin figure.
 *
 * Totals are accumulated in exact fractional minor units and rounded once, so
 * the total equals what a reader gets by adding the displayed rows in full
 * precision, not the sum of pre-rounded rows.
 */
export function rollUpMargin(
  lines: readonly CostLineLike[],
  reportingCurrency: string,
  rates: RateTable,
  asOf: Date = new Date(),
): MarginRollup {
  const active = lines.filter((line) => isLineActive(line, asOf));

  let costExact = 0;
  let chargeExact = 0;
  const computed: LineMargin[] = [];
  const uncounted: string[] = [];
  const flagCounts: Record<MarginFlagCode, number> = {
    no_charge: 0,
    not_invoiced: 0,
    below_cost: 0,
    charge_equals_cost: 0,
    missing_rate: 0,
  };

  for (const line of active) {
    const result = lineMargin(line, reportingCurrency, rates);
    computed.push(result);
    for (const f of result.flags) flagCounts[f.code] += 1;

    if (result.counted) {
      costExact += convertQuietly(line.costAmount, line.costCurrency, line.costCycle, reportingCurrency, rates);
      if (line.chargeAmount !== null && line.chargeCurrency !== null && line.chargeCycle !== null) {
        chargeExact += convertQuietly(
          line.chargeAmount,
          line.chargeCurrency,
          line.chargeCycle,
          reportingCurrency,
          rates,
        );
      }
    } else {
      uncounted.push(line.id);
    }
  }

  const marginExact = chargeExact - costExact;

  return {
    currency: reportingCurrency,
    monthlyCost: toMoney(costExact, reportingCurrency),
    monthlyCharge: toMoney(chargeExact, reportingCurrency),
    monthlyMargin: toMoney(marginExact, reportingCurrency),
    yearlyMargin: toMoney(marginExact * 12, reportingCurrency),
    marginRatio: chargeExact > 0 ? marginExact / chargeExact : null,
    lines: computed,
    uncountedLineIds: uncounted,
    incomplete: uncounted.length > 0,
    flagCounts,
  };
}

function convertQuietly(
  amount: number,
  currency: string,
  cycle: BillingCycle,
  reportingCurrency: string,
  rates: RateTable,
): ExactMinor {
  return convertExact(
    monthlyExact(money(amount, currency), cycle),
    currency,
    reportingCurrency,
    rates,
  );
}

/**
 * The lines worth acting on, most costly first. This drives the "money you are
 * losing" panel, which is the first screen a prospect should see.
 */
export function unbilledLines(rollup: MarginRollup): readonly LineMargin[] {
  return rollup.lines
    .filter((line) => line.flags.some((f) => f.code === "no_charge" || f.code === "below_cost"))
    .slice()
    .sort((a, b) => a.monthlyMargin.amount - b.monthlyMargin.amount);
}

/** Total monthly money leaking through unbilled or under-billed services. */
export function leakage(rollup: MarginRollup): Money {
  let exact = 0;
  for (const line of unbilledLines(rollup)) {
    exact += Math.min(0, line.monthlyMargin.amount);
  }
  return toMoney(-exact, rollup.currency);
}
