import Link from "next/link";
import { listOpenAlerts, listRecentAlerts } from "@stackkeeper/db";
import { EmptyState } from "@/components/empty-state";
import { PageHead } from "@/components/page-head";
import { StatusDot } from "@/components/status-dot";
import { AcknowledgeButton } from "@/components/acknowledge-button";
import { withPrincipal } from "@/lib/session";
import { relativeDays } from "@/lib/format";

export const dynamic = "force-dynamic";

const TONE = { critical: "critical", warning: "warning", info: "info" } as const;

export default async function AlertsPage() {
  const { open, recent } = await withPrincipal(async (tx, principal) => ({
    open: await listOpenAlerts(tx, principal.orgId),
    recent: await listRecentAlerts(tx, principal.orgId, 40),
  }));

  const resolved = recent.filter((alert) => alert.resolved_at !== null);

  return (
    <>
      <PageHead
        title="Alerts"
        description="Anything the monitors found that needs a person. Alerts close themselves when the problem goes away."
      />

      {open.length === 0 ? (
        <EmptyState title="Nothing needs attention">
          Every domain and certificate being watched is healthy. Alerts appear here and go to your
          notification channels at the same time.
        </EmptyState>
      ) : (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Open</h2>
              <p className="muted small">{open.length} waiting</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Asset</th>
                  <th scope="col">Since</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {open.map((alert) => (
                  <tr key={alert.id}>
                    <td>
                      <StatusDot
                        tone={TONE[alert.severity] ?? "info"}
                        label={alert.message}
                      />
                      {alert.needs_payment_confirmation ? (
                        <span className="sub">
                          The registry moved the date forward automatically. That happens before
                          anyone has paid, so confirm the renewal with the registrar.
                        </span>
                      ) : null}
                      <span className="sub mono">{alert.rule}</span>
                    </td>
                    <td>
                      {alert.client_id ? (
                        <Link href={`/clients/${alert.client_id}`}>
                          {alert.asset_label ?? "Asset"}
                        </Link>
                      ) : (
                        <span className="muted">{alert.asset_label ?? "—"}</span>
                      )}
                      {alert.client_name ? <span className="sub">{alert.client_name}</span> : null}
                    </td>
                    <td className="muted small">{relativeDays(alert.opened_at)}</td>
                    <td className="num">
                      <AcknowledgeButton alertId={alert.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {resolved.length > 0 ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Recently closed</h2>
              <p className="muted small">
                Closed either because the problem cleared, or because someone marked it done.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Asset</th>
                  <th scope="col">Closed</th>
                </tr>
              </thead>
              <tbody>
                {resolved.slice(0, 15).map((alert) => (
                  <tr key={alert.id}>
                    <td className="muted">{alert.message}</td>
                    <td className="muted">{alert.asset_label ?? "—"}</td>
                    <td className="muted small">{relativeDays(alert.resolved_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
