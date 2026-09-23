import { notFound } from "next/navigation";
import { getProject, listClients } from "@stackkeeper/db";
import { PageHead } from "@/components/page-head";
import { ProjectForm } from "@/components/project-form";
import { updateProjectAction } from "@/lib/actions/projects";
import { withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await withPrincipal(async (tx, principal) => ({
    project: await getProject(tx, id),
    clients: await listClients(tx, principal.orgId),
  }));
  if (!data.project) notFound();

  const action = updateProjectAction.bind(null, data.project.id, data.project.client_id);

  return (
    <>
      <PageHead
        title={data.project.name}
        breadcrumb={[
          { href: "/projects", label: "Projects" },
          { href: `/clients/${data.project.client_id}`, label: "Client" },
        ]}
      />
      <div className="card">
        <ProjectForm
          action={action}
          clients={data.clients}
          project={data.project}
          submitLabel="Save changes"
        />
      </div>
    </>
  );
}
