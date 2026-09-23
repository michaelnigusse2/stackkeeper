import Link from "next/link";
import { listAssets, listClients, listProjects } from "@stackkeeper/db";
import { EmptyState } from "@/components/empty-state";
import { PageHead } from "@/components/page-head";
import { withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  planning: "Planning",
  active: "Active",
  maintenance: "Maintenance",
  handed_over: "Handed over",
  archived: "Archived",
};

export default async function ProjectsPage() {
  const data = await withPrincipal(async (tx, principal) => {
    const [projects, clients, assets] = await Promise.all([
      listProjects(tx, principal.orgId),
      listClients(tx, principal.orgId),
      listAssets(tx, principal.orgId),
    ]);
    return { projects, clients, assets };
  });

  const clientById = new Map(data.clients.map((client) => [client.id, client]));
  const assetCount = new Map<string, number>();
  for (const asset of data.assets) {
    if (!asset.project_id) continue;
    assetCount.set(asset.project_id, (assetCount.get(asset.project_id) ?? 0) + 1);
  }

  return (
    <>
      <PageHead
        title="Projects"
        description="A way to group a client's infrastructure when they have more than one site or application."
      >
        {data.clients.length > 0 ? (
          <Link className="button primary" href="/projects/new">
            Add a project
          </Link>
        ) : null}
      </PageHead>

      {data.clients.length === 0 ? (
        <EmptyState title="Add a client first" action={{ href: "/clients/new", label: "Add a client" }}>
          Projects belong to clients, so there needs to be one to attach them to.
        </EmptyState>
      ) : data.projects.length === 0 ? (
        <EmptyState title="No projects yet" action={{ href: "/projects/new", label: "Add a project" }}>
          Projects are optional. Assets attach directly to a client, and a project is only useful
          when one client has several separate things you look after.
        </EmptyState>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Client</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Assets</th>
                  <th scope="col">Live</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={`/projects/${project.id}`}>{project.name}</Link>
                      {project.description ? (
                        <span className="sub truncate">{project.description}</span>
                      ) : null}
                    </td>
                    <td>
                      <Link href={`/clients/${project.client_id}`}>
                        {clientById.get(project.client_id)?.name ?? "Unknown"}
                      </Link>
                    </td>
                    <td>
                      <span className="badge">{STATUS_LABEL[project.status] ?? project.status}</span>
                    </td>
                    <td className="num">{assetCount.get(project.id) ?? 0}</td>
                    <td className="muted small truncate">
                      {project.live_url ? (
                        <a href={project.live_url} target="_blank" rel="noreferrer noopener">
                          {project.live_url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        "—"
                      )}
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
