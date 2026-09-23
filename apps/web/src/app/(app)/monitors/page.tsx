import { latestChecks, listAssets, listMonitors, toIsoDate } from "@stackkeeper/db";
import { EmptyState } from "@/components/empty-state";
import { Figure, Figures } from "@/components/figures";
import { MonitorList, type MonitorListRow } from "@/components/monitor-list";
import { PageHead } from "@/components/page-head";
import { withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MonitorsPage() {
  const data = await withPrincipal(async (tx, principal) => {
    const [monitors, checks, assets] = await Promise.all([
      listMonitors(tx, principal.orgId),
      latestChecks(tx, principal.orgId),
      listAssets(tx, principal.orgId),
    ]);
    return { monitors, checks, assets };
  });

  const checkByMonitor = new Map(data.checks.map((check) => [check.monitor_id, check]));
  const assetById = new Map(data.assets.map((asset) => [asset.id, asset]));

  const unhealthy = data.monitors.filter((m) => m.state === "critical" || m.state === "warning");
  const unchecked = data.monitors.filter((m) => m.state === "unknown");

  // Everything crossing into the client component is a plain serialisable
  // value. Dates become ISO strings here rather than in the row, so the row
  // never has to decide what shape it was handed.
  const rows: MonitorListRow[] = data.monitors.map((monitor) => ({
    monitor: {
      id: monitor.id,
      state: monitor.state,
      kind: monitor.kind,
      target: monitor.target,
      enabled: monitor.enabled,
      lastError: monitor.last_error,
      lastCheckedAt: monitor.last_checked_at
        ? new Date(monitor.last_checked_at).toISOString()
        : null,
      manualExpiresAt: toIsoDate(monitor.manual_expires_at),
      expiryIsManual: monitor.expiry_is_manual,
    },
    payload: checkByMonitor.get(monitor.id)?.payload ?? null,
    assetLabel: assetById.get(monitor.asset_id)?.label ?? null,
    clientId: assetById.get(monitor.asset_id)?.client_id ?? null,
  }));

  return (
    <>
      <PageHead
        title="Everything I watch"
        eyebrow="Monitors"
        description="Certificates are checked hourly and judged on how much of their life has gone, not on days remaining. Registrations are checked daily, or every six hours when expiry is close."
      />

      {data.monitors.length === 0 ? (
        <EmptyState
          title="Nothing is being watched yet"
          action={{ href: "/clients", label: "Go to clients" }}
        >
          Add a domain or a hosting record to a client and a monitor is created for it
          automatically. Servers recorded only by IP address are left alone, because there is
          nothing to check from outside.
        </EmptyState>
      ) : (
        <>
          <Figures>
            <Figure label="Watched" value={data.monitors.length} />
            <Figure
              label="Need attention"
              value={unhealthy.length}
              tone={unhealthy.length > 0 ? "negative" : undefined}
            />
            <Figure
              label="Not checked yet"
              value={unchecked.length}
              note={unchecked.length > 0 ? "The worker picks these up within five minutes." : undefined}
            />
          </Figures>

          <MonitorList rows={rows} />
        </>
      )}
    </>
  );
}
