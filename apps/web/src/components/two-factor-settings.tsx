"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Turning two-factor authentication on and off.
 *
 * Better Auth enables TOTP in two steps. `enable` checks the password and
 * returns an otpauth:// URI plus backup codes, but leaves two-factor off until
 * a code from the authenticator app is verified. That second step matters: it
 * proves the app was set up correctly before sign-in starts depending on it.
 *
 * There is no QR code yet, because that needs a dependency. The key can be
 * typed into any authenticator app, and on a phone the link opens one directly.
 */

interface Setup {
  readonly uri: string;
  readonly key: string;
  readonly backupCodes: readonly string[];
}

function keyFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/** Groups of four characters are far easier to type than one long run. */
function groupKey(key: string): string {
  return key.replace(/(.{4})/g, "$1 ").trim();
}

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.twoFactor.enable({
      password: String(form.get("password") ?? ""),
      method: "totp",
    });
    setBusy(false);
    if (result.error || !result.data || result.data.method !== "totp") {
      setError(result.error?.message ?? "That password was not accepted.");
      return;
    }
    const uri = result.data.totpURI;
    setSetup({ uri, key: keyFromUri(uri), backupCodes: result.data.backupCodes });
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.twoFactor.verifyTotp({
      code: String(form.get("code") ?? "").replace(/\s+/g, ""),
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "That code did not match. Check the time on your phone and try again.");
      return;
    }
    setSetup(null);
    router.refresh();
  }

  async function turnOff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.twoFactor.disable({
      password: String(form.get("password") ?? ""),
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "That password was not accepted.");
      return;
    }
    router.refresh();
  }

  const notice = error ? (
    <p className="notice error" role="alert">
      {error}
    </p>
  ) : null;

  if (enabled) {
    return (
      <form className="stack" onSubmit={turnOff}>
        <p className="notice ok" role="status">
          Two-factor authentication is on. Signing in asks for a code from your authenticator app.
        </p>
        {notice}
        <div className="field">
          <label htmlFor="two-factor-off-password">Password, to turn it off</label>
          <input
            id="two-factor-off-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="actions">
          <button type="submit" className="button danger" disabled={busy}>
            {busy ? "Turning off…" : "Turn off two-factor"}
          </button>
        </div>
      </form>
    );
  }

  if (setup) {
    return (
      <form className="stack" onSubmit={confirm}>
        {notice}
        <p>
          Add this key to your authenticator app (1Password, Bitwarden, Google Authenticator,
          Aegis and others all work), then enter the six-digit code it shows.
        </p>
        <p className="mono">{groupKey(setup.key)}</p>
        {setup.uri ? (
          <p className="small">
            <a href={setup.uri}>Open in an authenticator app on this device</a>
          </p>
        ) : null}

        {setup.backupCodes.length > 0 ? (
          <div className="stack-tight">
            <p className="small">
              Backup codes. Each works once if you lose your phone. Save them in your password
              manager now; they will not be shown again.
            </p>
            <p className="mono small">{setup.backupCodes.join("  ")}</p>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="two-factor-code">Code from the app</label>
          <input
            id="two-factor-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            required
            autoFocus
          />
        </div>
        <div className="actions">
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Checking…" : "Turn on two-factor"}
          </button>
          <button type="button" className="button quiet" onClick={() => setSetup(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="stack" onSubmit={start}>
      <p className="notice warning" role="status">
        Two-factor authentication is off.
      </p>
      {notice}
      <div className="field">
        <label htmlFor="two-factor-password">Password</label>
        <input id="two-factor-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div className="actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Checking…" : "Set up two-factor"}
        </button>
      </div>
    </form>
  );
}
