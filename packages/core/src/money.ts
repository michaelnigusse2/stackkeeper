/**
 * Money handling.
 *
 * Amounts are integer minor units (cents, santim, yen) plus an ISO 4217 code.
 * Floating point never touches a stored amount. Division, such as turning an
 * annual price into a monthly one, happens in an explicitly fractional space
 * (`ExactMinor`) so that a column of figures is summed first and rounded once,
 * rather than rounded at every row.
 */

export type CurrencyCode = string;

export interface Money {
  /** Integer minor units. Negative means a loss. */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

/**
 * A possibly fractional count of minor units, used only while calculating.
 * Convert back with `toMoney` before storing or displaying.
 */
export type ExactMinor = number;

/**
 * Currencies whose minor unit is not two decimal places. Everything absent
 * from this table is treated as two, which is correct for the large majority
 * of ISO 4217, including USD, EUR, GBP and ETB.
 */
const EXPONENTS: Readonly<Record<string, number>> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

/** Largest amount we accept, keeping every intermediate sum exact in a double. */
const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

export function assertCurrency(code: string): CurrencyCode {
  if (!isCurrencyCode(code)) {
    throw new MoneyError(`Not an ISO 4217 currency code: ${JSON.stringify(code)}`);
  }
  return code;
}

/** Decimal places for a currency's minor unit. */
export function exponentOf(currency: CurrencyCode): number {
  return EXPONENTS[assertCurrency(currency)] ?? 2;
}

export function money(amount: number, currency: string): Money {
  if (!Number.isInteger(amount)) {
    throw new MoneyError(`Money amount must be whole minor units, got ${amount}`);
  }
  if (Math.abs(amount) > MAX_MINOR) {
    throw new MoneyError(`Money amount is out of safe range: ${amount}`);
  }
  return { amount, currency: assertCurrency(currency) };
}

export function zero(currency: string): Money {
  return money(0, currency);
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Cannot combine ${a.currency} with ${b.currency}. Convert to one currency first.`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.amount, a.currency);
}

export function isZero(a: Money): boolean {
  return a.amount === 0;
}

export function compare(a: Money, b: Money): number {
  sameCurrency(a, b);
  return a.amount === b.amount ? 0 : a.amount < b.amount ? -1 : 1;
}

/**
 * Round a fractional minor-unit figure to a whole one.
 *
 * Ties go away from zero, the rule people expect when they check the sum by
 * hand. Banker's rounding would be less surprising to an accountant but more
 * surprising to the freelancer reading the screen.
 */
export function toMoney(exact: ExactMinor, currency: string): Money {
  if (!Number.isFinite(exact)) {
    throw new MoneyError(`Cannot round a non-finite amount: ${exact}`);
  }
  const rounded = exact < 0 ? -Math.round(-exact) : Math.round(exact);
  // Math.round(-0.5) is -0 in JavaScript; normalise so 0 compares equal.
  return money(rounded === 0 ? 0 : rounded, currency);
}

/** Parse "12.34", "12", "1,234.56" into minor units for the given currency. */
export function parseAmount(input: string, currency: string): Money {
  const code = assertCurrency(currency);
  const cleaned = input.trim().replace(/[\s,_]/g, "");
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === "-" || cleaned === ".") {
    throw new MoneyError(`Not a number: ${JSON.stringify(input)}`);
  }
  const exponent = exponentOf(code);
  const negative = cleaned.startsWith("-");
  const [whole = "0", fraction = ""] = cleaned.replace(/^-/, "").split(".");
  if (fraction.length > exponent) {
    throw new MoneyError(
      `${code} has ${exponent} decimal place(s); ${input} has ${fraction.length}`,
    );
  }
  const padded = fraction.padEnd(exponent, "0");
  const amount = Number(whole) * 10 ** exponent + Number(padded || "0");
  return money(negative ? -amount : amount, code);
}

/** Decimal string without a currency symbol, for example "12.34". */
export function formatAmount(value: Money): string {
  const exponent = exponentOf(value.currency);
  const sign = value.amount < 0 ? "-" : "";
  const digits = Math.abs(value.amount).toString().padStart(exponent + 1, "0");
  if (exponent === 0) return sign + digits;
  const whole = digits.slice(0, -exponent);
  const fraction = digits.slice(-exponent);
  return `${sign}${whole}.${fraction}`;
}

/** Localised display string, for example "$12.34" or "ETB 1,200.00". */
export function formatMoney(value: Money, locale = "en-US"): string {
  const exponent = exponentOf(value.currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(value.amount / 10 ** exponent);
}
