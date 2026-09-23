import Link from "next/link";
import { leakage, monthOf, RateTable, rollUpMargin, unbilledLines } from "@stackkeeper/core";
import {
  ensureSettings, expiringAssets, latestRates, listAssets, listClients, listCostLines,
  listMonitors, listOpenAlerts, toMarginInput,
} from "@stackkeeper/db";
import { EmptyState } from "@/components/empty-state";
import { Figure, Figures } from "@/components/figures";
import { PageHead } from "@/components/page-head";
import { Section } from "@/components/section";
import { WorklistItem } from "@/components/worklist";
import { toneForState } from "@/components/status-dot";
import { withPrincipal } from "@/lib/session";
import { daysUntil, money, percent, relativeDays, shortDays, signedMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

const SEVERITY_TONE = { critical: "critical", warning: "warning", info: "info" } as const;

export default async function DashboardPage() {
  const data = await withPrincipal(async (tx, principal) => {
    const settings = await ensureSettings(tx, principal.orgId);
    const [clients, costLines, rates, expiring, alerts, monitors, assets] = await Promise.all([
      listClients(tx, principal.orgId),
      listCostLines(tx, principal.orgId),
      latestRates(tx),
      expiringAssets(tx, principal.orgId, 60),
      listOpenAlerts(tx, principal.orgId),
      listMonitors(tx, principal.orgId),
      listAssets(tx, principal.orgId),
    ]);

    return {
      clients,
      alerts,
      monitors,
      expiring,
      assetCount: assets.length,
      currency: settings.reporting_currency,
      assetsById: new Map(assets.map((a) => [a.id, a])),
      rollup: rollUpMargin(
        costLines.map(toMarginInput),
        settings.reporting_currency,
        new RateTable(rates),
      ),
    };
  });

  if (data.clients.length === 0) {
    return (
      <>
        <PageHead title="Nothing tracked yet" />
        <EmptyState
          title="Start with one client"
          action={{ href: "/clients/new", label: "Add a client" }}
          secondary={{ href: "/import", label: "Import a spreadsheet" }}
        >
          Add your first client, or bring in the sheet you keep today. Monitoring starts by itself
          once there is a domain to watch.
        </EmptyState>
      </>
    );
  }

  const { rollup } = data;
  const leaking = leakage(rollup);
  const worst = unbilledLines(rollup).slice(0, 6);

  // Monitor health, counted once here rather than filtered three times below.
  const health = { ok: 0, warning: 0, critical: 0, unknown: 0 };
  for (const monitor of data.monitors) {
    const tone = toneForState(monitor.state);
    health[tone === "info" ? "unknown" : tone] += 1;
  }

  return (
    <>
      <PageHead
        title="What you run, and what it earns"
        description={
          <>
            Per month in {data.currency} · {data.clients.length} client
            {data.clients.length === 1 ? "" : "s"} · {data.assetCount} tracked service
            {data.assetCount === 1 ? "" : "s"}
            {rollup.incomplete
              ? ` · ${rollup.uncountedLineIds.length} line(s) have no exchange rate and are not counted`
              : ""}
          </>
        }
      >
        <Link className="button" href="/import">
          Import
        </Link>
        <Link className="button primary" href="/clients/new">
          New client
        </Link>
      </PageHead>

      <Figures>
        <Figure
          label="Infrastructure cost"
          value={money(rollup.monthlyCost)}
          note="What you pay out"
        />
        <Figure
          label="Charged to clients"
          value={money(rollup.monthlyCharge)}
          note="What comes back in"
        />
        <Figure
          label="Margin"
          value={signedMoney(rollup.monthlyMargin)}
          tone={rollup.monthlyMargin.amount < 0 ? "negative" : "positive"}
          note={`${percent(rollup.marginRatio)} of what you charge · ${money(rollup.yearlyMargin)} a year`}
        />
        <Figure
          label="Leaking"
          value={money(leaking)}
          tone={leaking.amount > 0 ? "negative" : undefined}
          note={`${rollup.flagCounts.no_charge} unbilled · ${rollup.flagCounts.below_cost} below cost`}
        />
      </Figures>

      <div className="split">
        <div className="col-main">
          <Section
            title="Needs attention"
            count={data.alerts.length}
            link={{ href: "/alerts", label: "All alerts" }}
          >
            {data.alerts.length === 0 ? (
              <p className="muted">
                Every domain and certificate being watched is healthy. Nothing is waiting on you.
              </p>
            ) : (
              data.alerts.slice(0, 6).map((alert) => (
                <WorklistItem
                  key={alert.id}
                  tone={SEVERITY_TONE[alert.severity] ?? "info"}
                  rule={alert.rule}
                  title={alert.message}
                  href={alert.client_id ? `/clients/${alert.client_id}` : undefined}
                  when={relativeDays(alert.opened_at)}
                  meta={
                    <>
                      {alert.asset_label ? (
                        <span className="mono">{alert.asset_label}</span>
                      ) : null}
                      {alert.asset_label && alert.client_name ? " · " : null}
                      {alert.client_name}
                      {alert.needs_payment_confirmation
                        ? " · registry auto-renew, not a paid invoice"
                        : null}
                    </>
                  }
                />
              ))
            )}
          </Section>

          <Section
            title="Money you are losing"
            description="Services you pay for that nobody is billed for, or that are billed below what they cost."
            link={worst.length > 0 ? { href: "/clients", label: "All clients" } : undefined}
          >
            {worst.length === 0 ? (
              <p className="muted">
                Nothing unbilled or under-charged. Every service you pay for is covered.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col" className="num">Costs you</th>
                      <th scope="col" className="num">You charge</th>
                      <th scope="col" className="num">Margin</th>
                      <th scope="col">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worst.map((line) => {
                      const asset = data.assetsById.get(line.assetId);
                      const reasons = line.flags.filter(
                        (f) => f.code === "no_charge" || f.code === "below_cost",
                      );
                      return (
                        <tr key={line.lineId}>
                          <td>
                            {asset ? (
                              <Link href={`/clients/${asset.client_id}`}>{asset.label}</Link>
                            ) : (
                              <span className="mono faint">{line.assetId.slice(0, 8)}</span>
                            )}
                            <span className="sub">
                              {asset?.provider ?? "Provider not recorded"}
                            </span>
                          </td>
                          <td className="num">{money(line.monthlyCost)}</td>
                          <td className="num">{money(line.monthlyCharge)}</td>
                          <td className="num negative">{signedMoney(line.monthlyMargin)}</td>
                          <td>
                            {reasons.map((flag) => (
                              <span
                                key={flag.code}
                                className={
                                  flag.code === "no_charge" ? "badge critical" : "badge warning"
                                }
                              >
                                {flag.code === "no_charge" ? "Not billed" : "Below cost"}
                              </span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>

        <aside className="rail">
          <Section
            title="What to invoice"
            description="Every charge due in a month, per client, plus costs nobody is billed for. Copy it into your invoicing tool."
          >
            <form className="stack-tight" method="get" action="/api/export/invoice">
              <div className="field">
                <label htmlFor="invoice-month">Month</label>
                <input
                  id="invoice-month"
                  name="month"
                  type="month"
                  defaultValue={monthOf(new Date())}
                  required
                />
              </div>
              <div className="actions">
                <button type="submit" className="button">
                  Download CSV
                </button>
              </div>
            </form>
          </Section>

          <Section title="Monitors" link={{ href: "/monitors", label: "Open" }}>
            <div className="line-item">
              <span className="dot ok" aria-hidden="true" />
              <span className="grow">Healthy</span>
              <span className="num">{health.ok}</span>
            </div>
            <div className="line-item">
              <span className="dot warning" aria-hidden="true" />
              <span className="grow">Warning</span>
              <span className="num">{health.warning}</span>
            </div>
            <div className="line-item">
              <span className="dot critical" aria-hidden="true" />
              <span className="grow">Critical</span>
              <span className="num">{health.critical}</span>
            </div>
            <div className="line-item">
              <span className="dot" aria-hidden="true" />
              <span className="grow faint">Never checked</span>
              <span className="num faint">{health.unknown}</span>
            </div>
          </Section>

          <Section title="Coming up" description="Recorded expiry dates in the next 60 days.">
            {data.expiring.length === 0 ? (
              <p className="muted small">
                Nothing with a recorded date is due in the next 60 days.
              </p>
            ) : (
              data.expiring.slice(0, 8).map((asset) => {
                const days = daysUntil(asset.expires_at);
                const urgency =
                  days !== null && days <= 7
                    ? "critical"
                    : days !== null && days <= 30
                      ? "warning"
                      : "";
                return (
                  <div className="line-item" key={asset.id}>
                    <span className={`line-lead ${urgency}`}>{shortDays(asset.expires_at)}</span>
                    <div className="grow">
                      <Link href={`/clients/${asset.client_id}`}>{asset.label}</Link>
                      <span className="sub">{asset.provider ?? "Provider not recorded"}</span>
                    </div>
                  </div>
                );
              })
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}
