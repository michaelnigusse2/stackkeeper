import Link from "next/link";
import {
  dueTotals, InvoiceMonthError, invoiceStatusText, invoiceSummary, monthOf, type InvoiceRow,
} from "@stackkeeper/core";
import { listInvoiceLines, recordAudit, toInvoiceInput } from "@stackkeeper/db";
import { PageHead } from "@/components/page-head";
import { PrintButton } from "@/components/print-button";
import { withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The monthly "what to invoice" summary as a printable page. Saving it as a
 * PDF is the browser's job: Print, then "Save as PDF". The same rows as the
 * CSV export, grouped by client, with a total per currency.
 */
export default async function InvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const month = (await searchParams).month || monthOf(new Date());

  const result = await withPrincipal(async (tx, principal) => {
    try {
      const rows = invoiceSummary((await listInvoiceLines(tx, principal.orgId)).map(toInvoiceInput), month);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "export.invoice_summary",
        data: { month, rows: rows.length, format: "print" },
      });
      return { rows };
    } catch (error) {
      if (error instanceof InvoiceMonthError) return { error: error.message };
      throw error;
    }
  });

  if ("error" in result) {
    return (
      <>
        <PageHead title="What to invoice" />
        <p className="notice error" role="alert">
          {result.error}
        </p>
      </>
    );
  }

  const byClient = new Map<string, InvoiceRow[]>();
  for (const row of result.rows) byClient.set(row.clientName, [...(byClient.get(row.clientName) ?? []), row]);

  return (
    <>
      <PageHead
        eyebrow="What to invoice"
        title={month}
        description="Every charge due this month, per client, in the currency you bill in. Plus costs nobody is charged for."
      >
        <Link className="button" href={`/api/export/invoice?month=${month}`}>
          CSV
        </Link>
        <PrintButton />
      </PageHead>

      {byClient.size === 0 ? (
        <p className="muted">Nothing is due in {month}.</p>
      ) : (
        [...byClient.entries()].map(([client, rows]) => {
          const totals = dueTotals(rows);
          return (
            <section className="card" key={client}>
              <div className="card-head">
                <div>
                  <h2>{client}</h2>
                  <p>
                    {totals.length === 0
                      ? "Nothing to invoice this month."
                      : `To invoice: ${totals.map((t) => `${t.currency} ${t.amount}`).join(" + ")}`}
                  </p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col">Due</th>
                      <th scope="col" className="num">Amount</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.lineId}>
                        <td>
                          {row.assetLabel}
                          <span className="sub">
                            {row.cycle}
                            {row.provider ? ` · ${row.provider}` : ""}
                          </span>
                        </td>
                        <td>{row.dueOn ?? (row.status === "due" ? "Monthly" : "—")}</td>
                        <td className="num">
                          {row.currency} {row.amount}
                        </td>
                        <td className={row.status === "due" ? undefined : "muted"}>
                          {invoiceStatusText(row.status)}
                          {row.status === "due" && row.markedInvoiced ? <span className="sub">marked invoiced</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
