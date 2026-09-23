import { listClients } from "@stackkeeper/db";
import { PageHead } from "@/components/page-head";
import { ProjectForm } from "@/components/project-form";
import { createProjectAction } from "@/lib/actions/projects";
import { withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const clients = await withPrincipal((tx, principal) => listClients(tx, principal.orgId));

  return (
    <>
      <PageHead title="Add a project" breadcrumb={[{ href: "/projects", label: "Projects" }]} />
      <div className="card">
        <ProjectForm
          action={createProjectAction}
          clients={clients}
          defaultClientId={client}
          submitLabel="Create project"
        />
      </div>
    </>
  );
}
