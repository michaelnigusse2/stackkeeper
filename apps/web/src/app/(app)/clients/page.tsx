import Link from "next/link";
import { listClients } from "@stackkeeper/db";
import { EmptyState } from "@/components/empty-state";
import { PageHead } from "@/components/page-head";
import { withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  active: "ok",
  prospect: "info",
  paused: "warning",
  former: "",
};

export default async function ClientsPage() {
  const clients = await withPrincipal((tx, principal) => listClients(tx, principal.orgId));

  return (
    <>
      <PageHead title="Clients" description={clients.length > 0 ? `${clients.length} in this workspace` : undefined}>
        <Link className="button" href="/import">Import</Link>
        <Link className="button primary" href="/clients/new">Add a client</Link>
      </PageHead>

      {clients.length === 0 ? (
        <EmptyState
          title="No clients yet"
          action={{ href: "/clients/new", label: "Add your first client" }}
          secondary={{ href: "/import", label: "Import a spreadsheet" }}
        >
          A client is whoever you maintain infrastructure for. Everything else hangs off them.
        </EmptyState>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Projects</th>
                  <th scope="col" className="num">Assets</th>
                  <th scope="col">Contact</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link href={`/clients/${client.id}`}>{client.name}</Link>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_TONE[client.status] ?? ""}`}>
                        {client.status}
                      </span>
                    </td>
                    <td className="num">{client.project_count}</td>
                    <td className="num">{client.asset_count}</td>
                    <td className="muted small truncate">
                      {client.primary_contact_email ?? "—"}
                    </td>
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
