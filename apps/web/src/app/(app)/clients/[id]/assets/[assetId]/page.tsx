import { notFound } from "next/navigation";
import { getAsset, getClient, listProjects, monitorsForAsset } from "@stackkeeper/db";
import { AssetForm } from "@/components/asset-form";
import { PageHead } from "@/components/page-head";
import { StatusDot, toneForState } from "@/components/status-dot";
import { updateAssetAction } from "@/lib/actions/assets";
import { withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  domain_expiry: "Registration",
  tls: "Certificate",
  dns: "DNS",
};

export default async function EditAssetPage({
  params,
}: {
  params: Promise<{ id: string; assetId: string }>;
}) {
  const { id, assetId } = await params;
  const data = await withPrincipal(async (tx, principal) => ({
    client: await getClient(tx, id),
    asset: await getAsset(tx, assetId),
    projects: await listProjects(tx, principal.orgId, id),
    monitors: await monitorsForAsset(tx, assetId),
  }));
  if (!data.client || !data.asset) notFound();

  const action = updateAssetAction.bind(null, data.asset.id);

  return (
    <>
      <PageHead
        title={data.asset.label}
        breadcrumb={[
          { href: "/clients", label: "Clients" },
          { href: `/clients/${id}`, label: data.client.name },
        ]}
      />

      {data.monitors.length > 0 ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Being watched</h2>
              <p className="muted small">Created automatically from this asset.</p>
            </div>
          </div>
          <div className="stack-tight">
            {data.monitors.map((monitor) => (
              <div key={monitor.id} className="spread">
                <span>
                  <StatusDot tone={monitor.enabled ? toneForState(monitor.state) : "unknown"} />{" "}
                  <span className="muted">{KIND_LABEL[monitor.kind] ?? monitor.kind}</span>{" "}
                  <span className="mono small">{monitor.target}</span>
                </span>
                <span className="small faint">
                  {monitor.last_checked_at
                    ? `checked ${new Date(monitor.last_checked_at).toISOString().slice(0, 16).replace("T", " ")}`
                    : "not checked yet"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card">
        <AssetForm
          action={action}
          clientId={id}
          projects={data.projects}
          asset={data.asset}
          submitLabel="Save changes"
        />
      </div>
    </>
  );
}
