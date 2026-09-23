import { ensureSettings, listChannels } from "@stackkeeper/db";
import { PageHead } from "@/components/page-head";
import { CurrencyForm } from "@/components/currency-form";
import { ChannelManager } from "@/components/channel-manager";
import { TwoFactorSettings } from "@/components/two-factor-settings";
import { requireSession, withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const data = await withPrincipal(async (tx, principal) => ({
    settings: await ensureSettings(tx, principal.orgId),
    channels: await listChannels(tx, principal.orgId),
  }));

  const session = await requireSession();
  const twoFactorEnabled = session.user.twoFactorEnabled === true;

  return (
    <>
      <PageHead title="Settings" />

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Two-factor authentication</h2>
            <p className="muted small">
              A code from your phone as well as your password. Worth turning on: this account holds
              a map of your clients&apos; infrastructure.
            </p>
          </div>
        </div>
        <TwoFactorSettings enabled={twoFactorEnabled} />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Reporting currency</h2>
            <p className="muted small">
              Costs and charges are recorded in whatever you actually pay and bill in. Totals are
              converted into this one.
            </p>
          </div>
        </div>
        <CurrencyForm current={data.settings.reporting_currency} />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Where alerts go</h2>
            <p className="muted small">
              Without a channel, alerts still appear in the application but nothing reaches you.
            </p>
          </div>
        </div>
        <ChannelManager
          channels={data.channels.map((channel) => ({
            id: channel.id,
            kind: channel.kind,
            label: channel.label,
            enabled: channel.enabled,
            hasSecret: channel.secret !== null,
          }))}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>What Stackkeeper stores</h2>
          </div>
        </div>
        <p>
          Client names, providers, addresses, renewal dates and amounts. It does not store
          passwords, SSH keys or API tokens, and it never asks for them. Where a credential
          exists, record a reference to the entry in your own password manager.
        </p>
        <p className="muted small">
          What it does hold is still worth protecting: a list of your clients and their servers is
          a useful map to an attacker. Turn on two-factor authentication above.
        </p>
      </div>
    </>
  );
}
