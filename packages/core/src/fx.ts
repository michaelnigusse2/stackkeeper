/**
 * Currency conversion.
 *
 * Conversion happens in major units, because the exchange rate between two
 * currencies is quoted that way and because minor units differ: 1000 JPY is
 * one thousand yen, while 1000 USD is ten dollars.
 */

import type { CurrencyCode, ExactMinor, Money } from "./money.ts";
import { assertCurrency, exponentOf } from "./money.ts";

export interface FxRate {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  /** Units of `quote` for one unit of `base`, in major units. */
  readonly rate: number;
  readonly asOf: string;
}

export class FxError extends Error {}

/**
 * Rates for one day. Lookup tries the direct pair, then the inverse, so a
 * table holding only USD to EUR can still answer EUR to USD.
 *
 * Cross rates through a pivot are deliberately not inferred: a silently
 * triangulated number is worse than an explicit "no rate for this pair", which
 * the interface can show as a prompt to add one.
 */
export class RateTable {
  readonly asOf: string;
  private readonly direct = new Map<string, number>();

  constructor(rates: readonly FxRate[], asOf?: string) {
    this.asOf = asOf ?? rates[0]?.asOf ?? "";
    for (const r of rates) {
      this.direct.set(`${assertCurrency(r.base)}>${assertCurrency(r.quote)}`, r.rate);
    }
  }

  rate(base: string, quote: string): number | undefined {
    const from = assertCurrency(base);
    const to = assertCurrency(quote);
    if (from === to) return 1;

    const forward = this.direct.get(`${from}>${to}`);
    if (forward !== undefined) return forward;

    const backward = this.direct.get(`${to}>${from}`);
    if (backward !== undefined && backward !== 0) return 1 / backward;

    return undefined;
  }

  has(base: string, quote: string): boolean {
    return this.rate(base, quote) !== undefined;
  }
}

/**
 * Convert a fractional minor-unit figure from one currency to another.
 * Stays fractional so that a column of converted rows is rounded only once.
 */
export function convertExact(
  amount: ExactMinor,
  from: string,
  to: string,
  rates: RateTable,
): ExactMinor {
  const fromCode = assertCurrency(from);
  const toCode = assertCurrency(to);
  if (fromCode === toCode) return amount;

  const rate = rates.rate(fromCode, toCode);
  if (rate === undefined) {
    throw new FxError(`No exchange rate from ${fromCode} to ${toCode} for ${rates.asOf || "the requested date"}`);
  }

  const major = amount / 10 ** exponentOf(fromCode);
  return major * rate * 10 ** exponentOf(toCode);
}

export function convert(value: Money, to: string, rates: RateTable): ExactMinor {
  return convertExact(value.amount, value.currency, to, rates);
}
