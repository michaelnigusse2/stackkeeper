/**
 * The monitoring worker.
 *
 * A long-lived Node process, separate from the web app, because the checks it
 * performs need raw sockets: a TLS handshake to read a certificate, and
 * WHOIS on port 43 for registries RDAP has not reached. Serverless and edge
 * runtimes cannot do this. Cloudflare Workers, for instance, expose no peer
 * certificate at all and block connections to Cloudflare's own address
 * ranges, which is where a large share of monitored sites live.
 *
 * The queue is Postgres through pg-boss, so a self-hosted deployment is two
 * containers and a database, with nothing else to operate.
 *
 * This process reads across every organisation, which migration 0004 grants
 * through explicit policies rather than by switching row-level security off.
 */

import PgBoss from "pg-boss";
import {
  alertContext, alertsAwaitingDelivery, channelsForOrganization, claimDueMonitors,
  createSql, markAlertNotified, openAlert, openRenewalAlert, previousCheck, recordCheck,
  resolveClearedAlerts, resolveStaleRenewalAlerts, secretBox, updateMonitorAfterCheck,
  upcomingAssetRenewals, upcomingCostLineRenewals, upsertRate,
  type MonitorRow, type Sql,
} from "@stackkeeper/db";
import { checkDomain, loadBootstrap } from "./checkers/domain.ts";
import { checkTls } from "./checkers/tls.ts";
import { JOBS, type CheckJob } from "./jobs.ts";
import { deliver, formatAlert } from "./notify.ts";
import { buildDomainOutcome, buildTlsOutcome } from "./pipeline.ts";
import { HostRateLimiter, jitter } from "./rate-limiter.ts";
import { renewalAlerts } from "./renewals.ts";

const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_ADMIN_URL is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.ALERT_FROM_EMAIL;
const ratesUrl = process.env.FX_RATES_URL ?? "https://open.er-api.com/v6/latest/USD";

/**
 * Registries are unforgiving: rdap.org allows ten requests every ten seconds,
 * and Nominet blocks an address for hours after sustained querying. One
 * request per second per host, with a small burst, stays well inside that.
 */
const limiter = new HostRateLimiter({ ratePerSecond: 1, burst: 3 });

async function main(): Promise<void> {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: "queue",
    retryLimit: 5,
    retryBackoff: true,
    expireInMinutes: 15,
  });

  boss.on("error", (error) => console.error("[queue]", error));

  await boss.start();
  const sql = createSql(databaseUrl as string, { max: 4 });

  await ensureQueues(boss);
  await registerHandlers(boss, sql);
  await scheduleRecurring(boss);

  // Warm the registry list once at start rather than on the first domain.
  void loadBootstrap().catch(() => undefined);

  console.log("[worker] started");

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, finishing in-flight work`);
    await boss.stop({ graceful: true });
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/**
 * pg-boss 10 will not accept a job for a queue that does not exist yet, so
 * every queue is declared before any handler is registered or any schedule is
 * set. The underlying insert is ON CONFLICT DO NOTHING, so this is safe to run
 * on every start and needs no separate provisioning step.
 */
async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of Object.values(JOBS)) {
    await boss.createQueue(name);
  }
}

async function registerHandlers(boss: PgBoss, sql: Sql): Promise<void> {
  /**
   * Fan out. Claiming pushes each monitor's next check forward immediately, so
   * a sweep that starts before the last one finished cannot queue the same
   * monitor twice. The real interval is set once the check completes.
   */
  await boss.work(JOBS.scheduleDueChecks, async () => {
    const due = await claimDueMonitors(sql, 200);
    for (const monitor of due) {
      const job: CheckJob = {
        monitorId: monitor.id,
        orgId: monitor.org_id,
        target: monitor.target,
      };
      await boss.send(monitor.kind === "tls" ? JOBS.checkTls : JOBS.checkDomain, job, {
        // Spread the batch so a hundred monitors do not hit one registry at once.
        startAfter: Math.round(jitter(5, 1) ),
      });
    }
    if (due.length > 0) console.log(`[worker] queued ${due.length} check(s)`);
  });

  await boss.work(JOBS.checkTls, async (jobs) => {
    for (const job of asArray(jobs)) {
      const data = job.data as CheckJob;
      const result = await checkTls(data.target, 443);
      const previous = await previousCheck(sql, data.monitorId);
      const outcome = buildTlsOutcome(result, previous);
      await applyOutcome(sql, data, outcome, null);
    }
  });

  await boss.work(JOBS.checkDomain, async (jobs) => {
    for (const job of asArray(jobs)) {
      const data = job.data as CheckJob;
      const monitor = await monitorById(sql, data.monitorId);
      const manual = monitor?.manual_expires_at ? new Date(monitor.manual_expires_at) : null;

      const result = await checkDomain(data.target, { limiter });
      const previous = await previousCheck(sql, data.monitorId);
      const outcome = buildDomainOutcome(result, previous, manual);
      await applyOutcome(sql, data, outcome, monitor?.asset_id ?? null);
    }
  });

  await boss.work(JOBS.deliverAlert, async () => {
    const pending = await alertsAwaitingDelivery(sql, 50);
    for (const alert of pending) {
      const context = await alertContext(sql, alert.id);
      const channels = await channelsForOrganization(sql, alert.org_id);

      if (channels.length === 0) {
        // Nowhere to send it. Mark it delivered so it does not pile up; the
        // alert is still visible in the application.
        await markAlertNotified(sql, alert.id);
        continue;
      }

      const message = formatAlert(alert, {
        assetLabel: context?.asset_label ?? null,
        clientName: context?.client_name ?? null,
        target: context?.target ?? "",
        appUrl,
      });

      let anyDelivered = false;
      for (const channel of channels) {
        let secret: string | null = null;
        if (channel.secret) {
          try {
            secret = secretBox().open(channel.secret);
          } catch (error) {
            console.error(`[worker] could not open the secret for ${channel.label}:`, (error as Error).message);
            continue;
          }
        }
        const sent = await deliver(channel, message, secret, { resendApiKey, fromEmail });
        if (sent.ok) anyDelivered = true;
        else console.warn(`[worker] ${sent.channel} failed: ${sent.detail}`);
      }

      // Only mark it sent if something actually took it, so a transient
      // outage retries rather than silently swallowing the alert.
      if (anyDelivered) await markAlertNotified(sql, alert.id);
    }
  });

  await boss.work(JOBS.refreshRates, async () => {
    try {
      const response = await fetch(ratesUrl, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`rates endpoint returned ${response.status}`);
      const body = (await response.json()) as { base_code?: string; base?: string; rates?: Record<string, unknown> };
      const base = body.base_code ?? body.base ?? "USD";
      const today = new Date().toISOString().slice(0, 10);

      let written = 0;
      for (const [quote, value] of Object.entries(body.rates ?? {})) {
        const rate = Number(value);
        if (!/^[A-Z]{3}$/.test(quote) || !Number.isFinite(rate) || rate <= 0) continue;
        await upsertRate(sql, today, base, quote, rate);
        written++;
      }
      console.log(`[worker] refreshed ${written} exchange rate(s)`);
    } catch (error) {
      // Margins still work when cost and charge share a currency, so a failed
      // refresh is a warning rather than something to retry aggressively.
      console.warn("[worker] could not refresh exchange rates:", (error as Error).message);
    }
  });

  /**
   * Renewal reminders for dates only the user knows: a cost line's next
   * payment, or the renewal date of a licence or hosting plan nothing
   * monitors. Opens what is newly due and closes what no longer applies.
   */
  await boss.work(JOBS.sweepRenewals, async () => {
    const [lines, assets] = await Promise.all([
      upcomingCostLineRenewals(sql),
      upcomingAssetRenewals(sql),
    ]);
    const alerts = renewalAlerts(lines, assets);

    let opened = 0;
    for (const alert of alerts) {
      const created = await openRenewalAlert(sql, {
        orgId: alert.orgId,
        assetId: alert.assetId,
        severity: alert.severity,
        rule: alert.rule,
        dedupeKey: alert.dedupeKey,
        message: alert.message,
        dueOn: alert.dueOn,
        source: alert.source,
        sourceId: alert.sourceId,
      });
      if (created) opened++;
    }
    const closed = await resolveStaleRenewalAlerts(sql, alerts.map((a) => a.dedupeKey));
    if (opened > 0 || closed > 0) {
      console.log(`[worker] renewals: opened ${opened}, closed ${closed}`);
    }
  });

  await boss.work(JOBS.purgeDeleted, async () => {
    const purged = await sql<Array<{ n: number }>>`
      with gone as (
        delete from app.client
        where deleted_at is not null and deleted_at < now() - interval '30 days'
        returning id
      )
      select count(*)::int as n from gone
    `;
    const count = purged[0]?.n ?? 0;
    if (count > 0) console.log(`[worker] purged ${count} deleted client(s)`);
  });
}

/** Store the result, raise and clear alerts, and reschedule the monitor. */
async function applyOutcome(
  sql: Sql,
  job: CheckJob,
  outcome: Awaited<ReturnType<typeof buildTlsOutcome>>,
  assetId: string | null,
): Promise<void> {
  await recordCheck(sql, {
    orgId: job.orgId,
    monitorId: job.monitorId,
    status: outcome.status,
    latencyMs: typeof outcome.payload.latencyMs === "number" ? outcome.payload.latencyMs : null,
    payload: outcome.payload,
  });

  for (const alert of outcome.alerts) {
    await openAlert(sql, {
      orgId: job.orgId,
      monitorId: job.monitorId,
      assetId,
      severity: alert.severity,
      rule: alert.rule,
      dedupeKey: alert.dedupeKey,
      message: alert.message,
      data: { target: job.target },
      needsPaymentConfirmation: alert.needsPaymentConfirmation,
    });
  }

  // Anything that was open but is no longer true closes itself, so a renewed
  // certificate clears its own alert without anyone clicking.
  await resolveClearedAlerts(sql, job.monitorId, outcome.alerts.map((a) => a.rule));

  await updateMonitorAfterCheck(sql, {
    monitorId: job.monitorId,
    state: outcome.status,
    nextCheckAt: outcome.nextCheckAt,
    error: outcome.error,
  });
}

async function monitorById(sql: Sql, id: string): Promise<MonitorRow | null> {
  const rows = await sql<MonitorRow[]>`select * from app.monitor where id = ${id}`;
  return rows[0] ?? null;
}

/** pg-boss hands a handler either one job or a batch, depending on version. */
function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

async function scheduleRecurring(boss: PgBoss): Promise<void> {
  // Wake often enough to notice what is due; each monitor sets its own pace.
  await boss.schedule(JOBS.scheduleDueChecks, "*/5 * * * *");
  await boss.schedule(JOBS.deliverAlert, "*/2 * * * *");
  await boss.schedule(JOBS.refreshRates, "15 4 * * *");
  await boss.schedule(JOBS.purgeDeleted, "30 3 * * *");
  // Hourly, so a date entered today is reminded about today, plus once on
  // start so a fresh deployment does not wait for the hour.
  await boss.schedule(JOBS.sweepRenewals, "7 * * * *");
  await boss.send(JOBS.sweepRenewals, {});
}

export { limiter };

main().catch((error) => {
  console.error("[worker] failed to start", error);
  process.exit(1);
});
