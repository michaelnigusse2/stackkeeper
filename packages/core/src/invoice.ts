/**
 * The monthly "what to invoice" summary.
 *
 * For one calendar month, which charges fall due and should appear on each
 * client's invoice, plus the costs you pay that no client is charged for.
 * Stackkeeper does not send invoices; this is the list you copy into whatever
 * you invoice with.
 *
 * Amounts stay in the charge's own currency. An invoice is written in the
 * currency you bill in, so converting to the reporting currency here would
 * produce numbers nobody can put on an invoice.
 *
 * When a charge falls due:
 *   - monthly: every month the line is active.
 *   - quarterly and longer: in the months that line up with the line's next
 *     renewal date, stepping by the charge cycle. With no renewal date the
 *     month cannot be known, so the line is listed as "due date unknown"
 *     rather than silently left out.
 *   - one-off: in the month it started. With no start date, and not yet
 *     marked invoiced, it is listed as "due date unknown".
 */

import type { BillingCycle } from "./cycle.ts";
import { cycleLabel, monthsPerCycle } from "./cycle.ts";
import { add, formatAmount, money, parseAmount, zero } from "./money.ts";
import { toDayString } from "./margin.ts";

export interface InvoiceLineInput {
  readonly lineId: string;
  readonly clientName: string;
  readonly assetLabel: string;
  readonly provider?: string | null;
  readonly costAmount: number;
  readonly costCurrency: string;
  readonly costCycle: BillingCycle;
  readonly chargeAmount: number | null;
  readonly chargeCurrency: string | null;
  readonly chargeCycle: BillingCycle | null;
  readonly billed: boolean;
  readonly nextRenewal?: string | Date | null;
  readonly startedOn?: string | Date | null;
  readonly endedOn?: string | Date | null;
  readonly note?: string | null;
}

export type InvoiceStatus = "due" | "due_date_unknown" | "not_charged";

export interface InvoiceRow {
  readonly lineId: string;
  readonly clientName: string;
  readonly assetLabel: string;
  readonly provider: string | null;
  readonly status: InvoiceStatus;
  /** Decimal string in `currency`, for example "12.00". */
  readonly amount: string;
  readonly currency: string;
  readonly cycle: string;
  /** The day it falls due, when that is a single known day. */
  readonly dueOn: string | null;
  readonly markedInvoiced: boolean;
  readonly note: string | null;
}

export class InvoiceMonthError extends Error {}

interface Month {
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  readonly first: string;
  readonly last: string;
}

/** Parse "2026-10" into its first and last day. */
export function parseMonth(value: string): Month {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) throw new InvoiceMonthError(`Expected a month like 2026-10, got "${value}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new InvoiceMonthError(`No month ${month} in a year`);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { year, month, first: `${year}-${mm}-01`, last: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

/** The month a date falls in, as "2026-10". */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/**
 * The day in `month` on which a charge anchored to `anchorDay` falls due, or
 * null when the cycle does not land in that month. The day of month is
 * clamped, so an anchor on the 31st falls due on the 30th in a 30-day month.
 */
export function dueDayInMonth(anchorDay: string, cycleMonths: number, month: Month): string | null {
  const year = Number(anchorDay.slice(0, 4));
  const monthNumber = Number(anchorDay.slice(5, 7));
  const day = Number(anchorDay.slice(8, 10));
  const gap = monthIndex(month.year, month.month) - monthIndex(year, monthNumber);
  if (((gap % cycleMonths) + cycleMonths) % cycleMonths !== 0) return null;
  const lastDay = Number(month.last.slice(8, 10));
  const dueDay = Math.min(day, lastDay);
  return `${month.first.slice(0, 8)}${String(dueDay).padStart(2, "0")}`;
}

/** True when the line is running at some point during the month. */
function activeDuring(line: InvoiceLineInput, month: Month): boolean {
  const startedOn = toDayString(line.startedOn);
  const endedOn = toDayString(line.endedOn);
  if (startedOn !== null && startedOn > month.last) return false;
  if (endedOn !== null && endedOn < month.first) return false;
  return true;
}

/** True when a due day sits inside the line's own start and end dates. */
function withinLine(line: InvoiceLineInput, dueDay: string): boolean {
  const startedOn = toDayString(line.startedOn);
  const endedOn = toDayString(line.endedOn);
  if (startedOn !== null && dueDay < startedOn) return false;
  if (endedOn !== null && dueDay > endedOn) return false;
  return true;
}

function amountText(amount: number, currency: string): string {
  return formatAmount(money(amount, currency));
}

function rowFor(
  line: InvoiceLineInput,
  status: InvoiceStatus,
  dueOn: string | null,
): InvoiceRow {
  const charged = status !== "not_charged";
  const amount = charged ? (line.chargeAmount as number) : line.costAmount;
  const currency = charged ? (line.chargeCurrency as string) : line.costCurrency;
  const cycle = charged ? (line.chargeCycle as BillingCycle) : line.costCycle;
  return {
    lineId: line.lineId,
    clientName: line.clientName,
    assetLabel: line.assetLabel,
    provider: line.provider ?? null,
    status,
    amount: amountText(amount, currency),
    currency,
    cycle: cycleLabel(cycle),
    dueOn,
    markedInvoiced: line.billed,
    note: line.note ?? null,
  };
}

function invoiceRowFor(line: InvoiceLineInput, month: Month): InvoiceRow | null {
  if (!activeDuring(line, month)) return null;

  const hasCharge =
    line.chargeAmount !== null && line.chargeCurrency !== null && line.chargeCycle !== null;

  if (!hasCharge) {
    // A one-off cost with no charge is only worth raising in its own month.
    if (line.costCycle === "once") {
      const startedOn = toDayString(line.startedOn);
      if (startedOn === null || startedOn < month.first || startedOn > month.last) return null;
      return rowFor(line, "not_charged", startedOn);
    }
    return rowFor(line, "not_charged", null);
  }

  const cycle = line.chargeCycle as BillingCycle;
  const months = monthsPerCycle(cycle);

  if (months === null) {
    const startedOn = toDayString(line.startedOn);
    if (startedOn !== null) {
      return startedOn >= month.first && startedOn <= month.last ? rowFor(line, "due", startedOn) : null;
    }
    return line.billed ? null : rowFor(line, "due_date_unknown", null);
  }

  if (months === 1) return rowFor(line, "due", null);

  const anchor = toDayString(line.nextRenewal);
  if (anchor === null) return rowFor(line, "due_date_unknown", null);
  const dueOn = dueDayInMonth(anchor, months, month);
  if (dueOn === null || !withinLine(line, dueOn)) return null;
  return rowFor(line, "due", dueOn);
}

const STATUS_ORDER: Readonly<Record<InvoiceStatus, number>> = {
  due: 0,
  due_date_unknown: 1,
  not_charged: 2,
};

/** Everything to invoice in `month` ("2026-10"), grouped by client. */
export function invoiceSummary(lines: readonly InvoiceLineInput[], month: string): InvoiceRow[] {
  const parsed = parseMonth(month);
  const rows: InvoiceRow[] = [];
  for (const line of lines) {
    const row = invoiceRowFor(line, parsed);
    if (row) rows.push(row);
  }
  return rows.sort(
    (a, b) =>
      a.clientName.localeCompare(b.clientName) ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.assetLabel.localeCompare(b.assetLabel),
  );
}

/** What is due, summed per currency: "USD 50.00", "ETB 1200.00". Never converted. */
export function dueTotals(rows: readonly InvoiceRow[]): { currency: string; amount: string }[] {
  const totals = new Map<string, ReturnType<typeof zero>>();
  for (const row of rows) {
    if (row.status !== "due") continue;
    const current = totals.get(row.currency) ?? zero(row.currency);
    totals.set(row.currency, add(current, parseAmount(row.amount, row.currency)));
  }
  return [...totals.values()]
    .map((total) => ({ currency: total.currency, amount: formatAmount(total) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

const STATUS_TEXT: Readonly<Record<InvoiceStatus, string>> = {
  due: "Invoice this month",
  due_date_unknown: "Check: due date unknown",
  not_charged: "You pay this; client not charged",
};

/**
 * A spreadsheet opening this file treats a cell starting with =, +, - or @
 * as a formula. Client and asset names are typed by users, so text cells are
 * prefixed with an apostrophe when they start that way.
 */
function textCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const INVOICE_CSV_HEADERS = [
  "Client",
  "Asset",
  "Provider",
  "Status",
  "Amount",
  "Currency",
  "Cycle",
  "Due on",
  "Marked invoiced",
  "Note",
] as const;

/**
 * The summary as CSV. Starts with a byte-order mark so Excel reads non-ASCII
 * client names correctly, and uses CRLF line endings as RFC 4180 asks.
 */
export function invoiceStatusText(status: InvoiceStatus): string {
  return STATUS_TEXT[status];
}

export function invoiceCsv(rows: readonly InvoiceRow[]): string {
  const lines = [INVOICE_CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        textCell(row.clientName),
        textCell(row.assetLabel),
        textCell(row.provider ?? ""),
        STATUS_TEXT[row.status],
        row.amount,
        row.currency,
        row.cycle,
        row.dueOn ?? "",
        row.markedInvoiced ? "yes" : "no",
        textCell(row.note ?? ""),
      ]
        .map(quote)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
