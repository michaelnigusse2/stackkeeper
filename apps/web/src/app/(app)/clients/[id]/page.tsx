import Link from "next/link";
import { notFound } from "next/navigation";
import { RateTable, rollUpMargin } from "@stackkeeper/core";
import {
  ensureSettings, getClient, latestRates, listAssets, listCostLinesForClient,
  listCredentialRefs, listProjects, monitorsForAsset, toMarginInput,
} from "@stackkeeper/db";
import { CostLineForm } from "@/components/cost-line-form";
import { CredentialForm } from "@/components/credential-form";
import { Figure, Figures } from "@/components/figures";
import { PageHead } from "@/components/page-head";
import { Section } from "@/components/section";
import { StatusDot, toneForState } from "@/components/status-dot";
import { withPrincipal } from "@/lib/session";
import { date, KIND_LABELS, money, PARTY_LABELS, percent, relativeDays, signedMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

const MANAGER_LABELS: Record<string, string> = {
  onepassword: "1Password",
  bitwarden: "Bitwarden",
  proton_pass: "Proton Pass",
  keepassxc: "KeePassXC",
  dashlane: "Dashlane",
  other: "Elsewhere",
};

/** The four ownership questions, in the order they matter on a handover. */
const OWNERSHIP_ROLES = [
  { key: "account_owner", label: "Account owner" },
  { key: "payer", label: "Payer" },
  { key: "registrant", label: "Registrant" },
  { key: "access_holder", label: "Access holder" },
] as const;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const data = await withPrincipal(async (tx, principal) => {
    const client = await getClient(tx, id);
    if (!client) return null;

    const settings = await ensureSettings(tx, principal.orgId);
    const [assets, costLines, credentials, rates, projects] = await Promise.all([
      listAssets(tx, principal.orgId, { clientId: id }),
      listCostLinesForClient(tx, principal.orgId, id),
      listCredentialRefs(tx, principal.orgId, id),
      latestRates(tx),
      listProjects(tx, principal.orgId, id),
    ]);

    const monitors = new Map<string, Awaited<ReturnType<typeof monitorsForAsset>>>();
    for (const asset of assets) monitors.set(asset.id, await monitorsForAsset(tx, asset.id));

    return {
      client,
      assets,
      credentials,
      projects,
      monitors,
      currency: settings.reporting_currency,
      rollup: rollUpMargin(costLines.map(toMarginInput), settings.reporting_currency, new RateTable(rates)),
    };
  });

  if (!data) notFound();

  const linesByAsset = new Map<string, (typeof data.rollup.lines)[number][]>();
  for (const line of data.rollup.lines) {
    linesByAsset.set(line.assetId, [...(linesByAsset.get(line.assetId) ?? []), line]);
  }

  const projectById = new Map(data.projects.map((project) => [project.id, project]));
  const flagged = data.rollup.flagCounts.no_charge + data.rollup.flagCounts.below_cost;

  // For each ownership role, who holds it across this client's assets, and how
  // many are unanswered. The unanswered count is the useful number: it is the
  // question nobody can answer on the day the client leaves.
  const ownership = OWNERSHIP_ROLES.map((role) => {
    const counts = new Map<string, number>();
    for (const asset of data.assets) {
      const party = asset[role.key];
      counts.set(party, (counts.get(party) ?? 0) + 1);
    }
    const unknown = counts.get("unknown") ?? 0;
    const known = [...counts.entries()]
      .filter(([party]) => party !== "unknown")
      .sort((a, b) => b[1] - a[1]);
    return { ...role, known, unknown };
  });

  return (
    <>
      <PageHead
        title={data.client.name}
        eyebrow="Client"
        breadcrumb={[{ href: "/clients", label: "Clients" }]}
        status={
          <>
            <StatusDot
              tone={data.client.status === "active" ? "ok" : "unknown"}
              label={data.client.status}
            />
            <span aria-hidden="true">·</span>
            <span>{data.client.primary_contact_email ?? "No contact recorded"}</span>
          </>
        }
      >
        <Link className="button" href={`/projects/new?client=${data.client.id}`}>
          Add a project
        </Link>
        <Link className="button" href={`/clients/${id}/edit`}>
          Edit
        </Link>
        <Link className="button primary" href={`/clients/${id}/assets/new`}>
          Add an asset
        </Link>
      </PageHead>

      <Figures compact>
        <Figure label="Costs you" value={money(data.rollup.monthlyCost)} unit="/mo" />
        <Figure label="They pay you" value={money(data.rollup.monthlyCharge)} unit="/mo" />
        <Figure
          label="Margin"
          value={signedMoney(data.rollup.monthlyMargin)}
          unit={` · ${percent(data.rollup.marginRatio)}`}
          tone={data.rollup.monthlyMargin.amount < 0 ? "negative" : "positive"}
        />
        <Figure label="Services" value={data.assets.length} />
        <Figure
          label="Needs a look"
          value={flagged}
          tone={flagged > 0 ? "negative" : undefined}
        />
      </Figures>

      {flagged > 0 ? (
        <p className="notice warning">
          {data.rollup.flagCounts.no_charge} service(s) you pay for are not billed to this client,
          and {data.rollup.flagCounts.below_cost} are billed below cost.
        </p>
      ) : null}

      <div className="split">
        <div className="col-main">
          <Section
            title="Infrastructure"
            count={data.assets.length}
            description="What you look after, who owns it, and what it earns or costs."
            action={
              <Link className="button small" href={`/clients/${id}/assets/new`}>
                New
              </Link>
            }
          >
            {data.assets.length === 0 ? (
              <p className="muted">
                Nothing tracked yet.{" "}
                <Link href={`/clients/${id}/assets/new`}>Add the first asset</Link>.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Asset</th>
                      <th scope="col">Type</th>
                      <th scope="col">Watching</th>
                      <th scope="col">Account in the name of</th>
                      <th scope="col">Pays</th>
                      <th scope="col">Expires</th>
                      <th scope="col" className="num">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.assets.map((asset) => {
                      const lines = linesByAsset.get(asset.id) ?? [];
                      const total = lines.reduce((sum, line) => sum + line.monthlyMargin.amount, 0);
                      const hasProblem = lines.some((line) =>
                        line.flags.some((f) => f.code === "no_charge" || f.code === "below_cost"),
                      );
                      const monitors = data.monitors.get(asset.id) ?? [];
                      const worst = monitors.find((m) => m.state === "critical")
                        ?? monitors.find((m) => m.state === "warning")
                        ?? monitors[0];

                      return (
                        <tr key={asset.id}>
                          <td>
                            <Link href={`/clients/${id}/assets/${asset.id}`}>{asset.label}</Link>
                            {asset.identifier ? (
                              <span className="sub mono">{asset.identifier}</span>
                            ) : null}
                            {asset.project_id ? (
                              <span className="sub">{projectById.get(asset.project_id)?.name}</span>
                            ) : null}
                          </td>
                          <td className="muted">{KIND_LABELS[asset.kind] ?? asset.kind}</td>
                          <td>
                            {monitors.length === 0 ? (
                              <span className="faint">—</span>
                            ) : (
                              <StatusDot
                                tone={worst ? toneForState(worst.state) : "unknown"}
                                label={`${monitors.length} check${monitors.length > 1 ? "s" : ""}`}
                              />
                            )}
                          </td>
                          <td className={asset.account_owner === "unknown" ? "faint" : ""}>
                            {PARTY_LABELS[asset.account_owner]}
                          </td>
                          <td className={asset.payer === "unknown" ? "faint" : ""}>
                            {PARTY_LABELS[asset.payer]}
                          </td>
                          <td className="muted small">
                            {asset.expires_at ? (
                              <>
                                {date(asset.expires_at)}
                                <span className="sub">{relativeDays(asset.expires_at)}</span>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="num">
                            {lines.length === 0 ? (
                              <span className="badge warning">No costs</span>
                            ) : (
                              <>
                                {signedMoney({ amount: total, currency: data.currency })}
                                {hasProblem ? (
                                  <span className="sub">
                                    <span className="badge critical">Check</span>
                                  </span>
                                ) : null}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {data.assets.length > 0 ? (
            <Section
              title="Costs and charges"
              description="What you pay, and what the client pays you. Leave the charge blank when nobody is billed for it, which is exactly what the dashboard looks for."
            >
              {data.assets.map((asset) => (
                <details key={asset.id}>
                  <summary>{asset.label}</summary>
                  <CostLineForm assetId={asset.id} clientId={id} defaultCurrency={data.currency} />
                </details>
              ))}
            </Section>
          ) : null}
        </div>

        <aside className="rail">
          <Section
            title="Who holds what"
            description="The answer you need the day they leave."
          >
            {data.assets.length === 0 ? (
              <p className="muted small">Nothing tracked yet.</p>
            ) : (
              ownership.map((role) => (
                <div className="line-item" key={role.key}>
                  <span className="grow muted">{role.label}</span>
                  <span className="small">
                    {role.known.length === 0 ? (
                      <span className="badge warning">None recorded</span>
                    ) : (
                      <>
                        {role.known
                          .map(([party, count]) => `${PARTY_LABELS[party] ?? party} (${count})`)
                          .join(" · ")}
                        {role.unknown > 0 ? (
                          <span className="badge warning">{role.unknown} missing</span>
                        ) : null}
                      </>
                    )}
                  </span>
                </div>
              ))
            )}
          </Section>

          <Section
            title="Where the credentials live"
            count={data.credentials.length}
            description="A pointer, never the secret. If the pointer breaks, nothing is lost, because the secret was never here."
          >
            {data.credentials.length === 0 ? (
              <p className="muted small">No references recorded.</p>
            ) : (
              data.credentials.map((credential) => (
                <div className="line-item" key={credential.id}>
                  <div className="grow">
                    <div>{credential.label}</div>
                    <span className="sub">
                      {MANAGER_LABELS[credential.manager] ?? credential.manager}
                      {credential.reference ? ` · ${credential.reference}` : ""}
                    </span>
                  </div>
                  <span className="small faint nowrap">{PARTY_LABELS[credential.holder]}</span>
                </div>
              ))
            )}
            <div className="card-foot">
              <details>
                <summary>Add a reference</summary>
                <CredentialForm clientId={id} assets={data.assets} />
              </details>
            </div>
          </Section>

          {data.projects.length > 0 ? (
            <Section title="Projects" count={data.projects.length}>
              {data.projects.map((project) => (
                <div className="line-item" key={project.id}>
                  <div className="grow">
                    <Link href={`/projects/${project.id}`}>{project.name}</Link>
                    <span className="sub">{project.status}</span>
                  </div>
                </div>
              ))}
            </Section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
