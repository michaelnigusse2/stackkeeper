import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isReportToken } from "@stackkeeper/core";
import { getClient, listAssets, monitorsForAsset, resolveReportLink } from "@stackkeeper/db";
import { PageHead } from "@/components/page-head";
import { StatusDot, toneForState } from "@/components/status-dot";
import { appSql, tenant } from "@/lib/db";
import { date, KIND_LABELS, relativeDays } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Infrastructure report",
  // The URL is the key. Keep it out of search engines, and out of the
  // Referer header of any link followed from this page.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Ownership as the client reads it: "you" is the client here, not the agency. */
const PARTY_FOR_CLIENT: Readonly<Record<string, string>> = {
  agency: "Your developer",
  client: "You",
  third_party: "A third party",
  unknown: "Not recorded",
};

const OWNERSHIP = [
  { key: "account_owner", label: "Account in the name of" },
  { key: "payer", label: "Paid by" },
  { key: "registrant", label: "Registered to" },
  { key: "access_holder", label: "Login held by" },
] as const;

const MONITOR_LABELS: Readonly<Record<string, string>> = {
  domain_expiry: "Registration",
  tls: "Certificate",
  dns: "DNS",
};

/**
 * A client's read-only view of what is looked after for them.
 *
 * No session. The token in the URL is hashed and looked up through the one
 * database function that can find a link without an organisation; everything
 * after that goes through the ordinary tenant path, so row-level security
 * still scopes every read. Unknown, revoked and expired links all give the
 * same 404, so the page says nothing about which tokens once existed.
 *
 * Deliberately left out: costs, margins, charges, credential references,
 * notes, and identifiers such as IP addresses. This page can be forwarded.
 */
export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isReportToken(token)) notFound();

  const hash = createHash("sha256").update(token).digest();
  const link = await resolveReportLink(appSql(), hash);
  if (!link) notFound();

  const data = await tenant(link.org_id, async (tx) => {
    const client = await getClient(tx, link.client_id);
    if (!client) return null;
    const assets = await listAssets(tx, link.org_id, { clientId: client.id });
    const monitors = await Promise.all(assets.map((asset) => monitorsForAsset(tx, asset.id)));
    return {
      client,
      rows: assets.map((asset, index) => ({ asset, monitors: monitors[index] ?? [] })),
    };
  });
  if (!data) notFound();

  const unanswered = data.rows.reduce(
    (count, { asset }) => count + OWNERSHIP.filter((role) => asset[role.key] === "unknown").length,
    0,
  );

  return (
    <main className="main report">
      <PageHead
        eyebrow="Infrastructure report"
        title={data.client.name}
        description={
          <>
            {data.rows.length} service{data.rows.length === 1 ? "" : "s"} looked after for you, as of{" "}
            {date(new Date())}. This link stops working {relativeDays(link.expires_at)}.
          </>
        }
      />

      <section className="card">
        <div className="card-head">
          <div>
            <h2>What is running, and when it renews</h2>
            <p>Domains and certificates are checked automatically; other dates are as recorded.</p>
          </div>
        </div>
        {data.rows.length === 0 ? (
          <p className="muted">Nothing has been recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Renews or expires</th>
                  <th scope="col">Checks</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ asset, monitors }) => (
                  <tr key={asset.id}>
                    <td>
                      {asset.label}
                      <span className="sub">
                        {KIND_LABELS[asset.kind] ?? asset.kind}
                        {asset.provider ? ` · ${asset.provider}` : ""}
                      </span>
                    </td>
                    <td>
                      {asset.expires_at ? (
                        <>
                          {date(asset.expires_at)}
                          <span className="sub">{relativeDays(asset.expires_at)}</span>
                        </>
                      ) : (
                        <span className="muted">No date recorded</span>
                      )}
                    </td>
                    <td>
                      {monitors.length === 0 ? (
                        <span className="muted small">Not monitored</span>
                      ) : (
                        monitors.map((monitor) => (
                          <div key={monitor.id}>
                            <StatusDot
                              tone={monitor.enabled ? toneForState(monitor.state) : "unknown"}
                              label={`${MONITOR_LABELS[monitor.kind] ?? monitor.kind}: ${
                                monitor.enabled ? stateWord(monitor.state) : "paused"
                              }`}
                            />
                            {monitor.last_checked_at ? (
                              <span className="sub">checked {relativeDays(monitor.last_checked_at)}</span>
                            ) : null}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.rows.length > 0 ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Who owns what</h2>
              <p>
                Whose name each account is in, and who pays for it. Worth checking: accounts in the
                wrong name are the hardest thing to recover if people move on.
                {unanswered > 0 ? ` ${unanswered} answer${unanswered === 1 ? " is" : "s are"} not recorded yet.` : ""}
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  {OWNERSHIP.map((role) => (
                    <th scope="col" key={role.key}>
                      {role.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ asset }) => (
                  <tr key={asset.id}>
                    <td>{asset.label}</td>
                    {OWNERSHIP.map((role) => (
                      <td key={role.key} className={asset[role.key] === "unknown" ? "muted" : undefined}>
                        {PARTY_FOR_CLIENT[asset[role.key]] ?? asset[role.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="small faint">
        Read-only. Passwords and keys are never stored in Stackkeeper, so none appear here.
      </p>
    </main>
  );
}

function stateWord(state: string): string {
  switch (state) {
    case "ok":
      return "healthy";
    case "warning":
      return "needs attention";
    case "critical":
    case "error":
      return "urgent";
    default:
      return "not checked yet";
  }
}
