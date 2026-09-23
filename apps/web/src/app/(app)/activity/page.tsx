import { listAudit } from "@stackkeeper/db";
import { EmptyState } from "@/components/empty-state";
import { PageHead } from "@/components/page-head";
import { withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Readable names for the actions recorded in the audit log. */
const ACTIONS: Record<string, string> = {
  "client.created": "added a client",
  "client.updated": "edited a client",
  "client.deleted": "deleted a client",
  "project.created": "added a project",
  "project.updated": "edited a project",
  "project.deleted": "deleted a project",
  "asset.created": "added an asset",
  "asset.updated": "edited an asset",
  "asset.deleted": "deleted an asset",
  "cost_line.created": "recorded costs",
  "cost_line.updated": "changed costs",
  "cost_line.deleted": "removed costs",
  "cost_line.marked_billed": "marked something invoiced",
  "cost_line.marked_unbilled": "marked something not invoiced",
  "credential_ref.created": "added a credential reference",
  "credential_ref.updated": "edited a credential reference",
  "credential_ref.deleted": "removed a credential reference",
  "settings.currency_changed": "changed the reporting currency",
  "import.csv": "imported a spreadsheet",
  "monitor.enabled": "turned a monitor on",
  "monitor.disabled": "turned a monitor off",
  "monitor.deleted": "removed a monitor",
  "monitor.manual_expiry_set": "set an expiry date by hand",
  "alert.acknowledged": "closed an alert",
};

export default async function ActivityPage() {
  const entries = await withPrincipal((tx, principal) => listAudit(tx, principal.orgId, 200));

  return (
    <>
      <PageHead
        title="Activity"
        description="Everything that has changed in this workspace. The application can add to this log but cannot rewrite or delete it."
      />

      {entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet">
          Actions appear here as soon as you start adding clients and assets.
        </EmptyState>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What happened</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="muted small mono">
                      {new Date(entry.created_at).toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td>
                      {ACTIONS[entry.action] ?? entry.action}
                      {entry.actor_user_id ? null : <span className="sub">by the system</span>}
                    </td>
                    <td className="muted small">{describe(entry.data)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function describe(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    // A nested object would print as [object Object] through String().
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    parts.push(`${key}: ${text}`);
  }
  return parts.join(" · ") || "—";
}
