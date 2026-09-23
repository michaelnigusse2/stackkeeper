/**
 * Form validation.
 *
 * Hand-rolled rather than pulled from a schema library: the rules here are
 * few, the error messages need to read like a person wrote them, and one less
 * dependency is one less thing to upgrade on a part-time budget.
 *
 * Every parser returns either a value or an error keyed by field, so a server
 * action can send the whole set back to the form at once instead of failing on
 * the first problem.
 */

import type { BillingCycle } from "./cycle.ts";
import { isBillingCycle } from "./cycle.ts";
import type { Money } from "./money.ts";
import { MoneyError, parseAmount } from "./money.ts";

export interface FieldErrors {
  [field: string]: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldErrors };

/** Collects values and errors while parsing one form. */
export class FormReader {
  private readonly data: Map<string, string>;
  readonly errors: FieldErrors = {};

  constructor(entries: Iterable<[string, string]>) {
    this.data = new Map(entries);
  }

  /**
   * Reads a `FormData`, structurally.
   *
   * Typed as a plain iterable of pairs rather than as `FormData`, because
   * naming `FormDataEntryValue` drags the DOM library into this package.
   * That is fine while core compiles on its own -- its tsconfig asks for
   * DOM -- but `packages/db` compiles core's source through a path mapping
   * and does not, so the name was simply missing there and the build broke
   * in a package that never touches a form. The values arrive as `unknown`
   * and the non-strings are dropped a line below, which is what the old
   * signature did anyway.
   */
  static fromFormData(form: { entries(): Iterable<[string, unknown]> }): FormReader {
    const pairs: Array<[string, string]> = [];
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") pairs.push([key, value]);
    }
    return new FormReader(pairs);
  }

  private fail(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  raw(field: string): string {
    return (this.data.get(field) ?? "").trim();
  }

  get valid(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  result<T>(value: T): ValidationResult<T> {
    return this.valid ? { ok: true, value } : { ok: false, errors: this.errors };
  }

  text(field: string, label: string, options: { max?: number } = {}): string {
    const value = this.raw(field);
    const max = options.max ?? 500;
    if (value.length > max) this.fail(field, `${label} must be ${max} characters or fewer.`);
    return value;
  }

  requiredText(field: string, label: string, options: { max?: number } = {}): string {
    const value = this.text(field, label, options);
    if (value === "") this.fail(field, `${label} is required.`);
    return value;
  }

  optionalText(field: string, label: string, options: { max?: number } = {}): string | null {
    const value = this.text(field, label, options);
    return value === "" ? null : value;
  }

  choice<T extends string>(
    field: string,
    label: string,
    allowed: readonly T[],
    fallback: T,
  ): T {
    const value = this.raw(field);
    if (value === "") return fallback;
    if (!(allowed as readonly string[]).includes(value)) {
      this.fail(field, `${label} is not one of the accepted values.`);
      return fallback;
    }
    return value as T;
  }

  boolean(field: string): boolean {
    const value = this.raw(field).toLowerCase();
    return value === "on" || value === "true" || value === "1" || value === "yes";
  }

  email(field: string, label: string, required = false): string | null {
    const value = this.raw(field);
    if (value === "") {
      if (required) this.fail(field, `${label} is required.`);
      return null;
    }
    if (!isEmail(value)) this.fail(field, `${label} does not look like an email address.`);
    return value;
  }

  url(field: string, label: string): string | null {
    const value = this.raw(field);
    if (value === "") return null;
    if (!isHttpUrl(value)) this.fail(field, `${label} must start with http:// or https://.`);
    return value;
  }

  uuid(field: string, label: string, required = true): string | null {
    const value = this.raw(field);
    if (value === "") {
      if (required) this.fail(field, `${label} is required.`);
      return null;
    }
    if (!isUuid(value)) this.fail(field, `${label} is not a valid identifier.`);
    return value;
  }

  /** An ISO calendar date, YYYY-MM-DD, that is a real day. */
  date(field: string, label: string): string | null {
    const value = this.raw(field);
    if (value === "") return null;
    if (!isIsoDate(value)) this.fail(field, `${label} must be a date such as 2026-09-20.`);
    return value;
  }

  currency(field: string, label: string, fallback: string): string {
    const value = this.raw(field).toUpperCase();
    if (value === "") return fallback;
    if (!/^[A-Z]{3}$/.test(value)) {
      this.fail(field, `${label} must be a three-letter code such as USD.`);
      return fallback;
    }
    return value;
  }

  cycle(field: string, label: string, fallback: BillingCycle): BillingCycle {
    const value = this.raw(field);
    if (value === "") return fallback;
    if (!isBillingCycle(value)) {
      this.fail(field, `${label} is not a billing cycle we recognise.`);
      return fallback;
    }
    return value;
  }

  /** A decimal amount in the given currency, returned as minor units. */
  money(field: string, label: string, currency: string, required = true): Money | null {
    const value = this.raw(field);
    if (value === "") {
      if (required) this.fail(field, `${label} is required.`);
      return null;
    }
    try {
      const parsed = parseAmount(value, currency);
      if (parsed.amount < 0) {
        this.fail(field, `${label} cannot be negative.`);
        return null;
      }
      return parsed;
    } catch (error) {
      this.fail(
        field,
        error instanceof MoneyError ? error.message : `${label} is not a valid amount.`,
      );
      return null;
    }
  }
}

export function isEmail(value: string): boolean {
  // Deliberately permissive: the only reliable test of an address is sending
  // to it. This rejects the obvious mistakes and nothing else.
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) && value.length <= 254;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}
