import { notFound } from "next/navigation";
import { getClient, listProjects } from "@stackkeeper/db";
import { AssetForm } from "@/components/asset-form";
import { PageHead } from "@/components/page-head";
import { createAssetAction } from "@/lib/actions/assets";
import { withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await withPrincipal(async (tx, principal) => ({
    client: await getClient(tx, id),
    projects: await listProjects(tx, principal.orgId, id),
  }));
  if (!data.client) notFound();

  return (
    <>
      <PageHead
        title="Add an asset"
        description="A domain or a site starts being watched as soon as you save it."
        breadcrumb={[
          { href: "/clients", label: "Clients" },
          { href: `/clients/${id}`, label: data.client.name },
        ]}
      />
      <div className="card">
        <AssetForm
          action={createAssetAction}
          clientId={id}
          projects={data.projects}
          submitLabel="Add asset"
        />
      </div>
    </>
  );
}
