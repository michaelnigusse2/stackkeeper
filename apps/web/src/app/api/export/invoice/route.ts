import { headers } from "next/headers";
import { InvoiceMonthError, invoiceCsv, invoiceSummary, monthOf } from "@stackkeeper/core";
import { listInvoiceLines, recordAudit, toInvoiceInput } from "@stackkeeper/db";
import { getSession, resolveActiveOrganization } from "@/lib/session";
import { tenant } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The monthly "what to invoice" summary as a CSV download.
 *
 *   GET /api/export/invoice?month=2026-10
 *
 * Like the search endpoint, an expired session gets a 401 rather than a
 * redirect to an HTML page, and the query runs inside `tenant`, so row-level
 * security scopes it to the caller's workspace. Exports are recorded in the
 * audit log: this file is a list of clients and what they pay.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response("Sign in to export.", { status: 401 });
  }

  const requestHeaders = await headers();
  const orgId =
    session.session.activeOrganizationId ?? (await resolveActiveOrganization(requestHeaders));
  if (!orgId) {
    return new Response("No workspace yet.", { status: 404 });
  }

  const month = new URL(request.url).searchParams.get("month") || monthOf(new Date());

  let csv: string;
  try {
    csv = await tenant(orgId, async (tx) => {
      const lines = await listInvoiceLines(tx, orgId);
      const rows = invoiceSummary(lines.map(toInvoiceInput), month);
      await recordAudit(tx, orgId, {
        actorUserId: session.user.id,
        action: "export.invoice_summary",
        userAgent: requestHeaders.get("user-agent"),
        data: { month, rows: rows.length },
      });
      return invoiceCsv(rows);
    });
  } catch (error) {
    if (error instanceof InvoiceMonthError) {
      return new Response(error.message, { status: 400 });
    }
    throw error;
  }

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="stackkeeper-to-invoice-${month}.csv"`,
      "cache-control": "no-store, private",
    },
  });
}
