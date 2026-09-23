"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, signIn } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once the password is accepted but the account has two-factor on.
  const [needsCode, setNeedsCode] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  function finish() {
    router.push("/dashboard");
    router.refresh();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });

    if (result.error) {
      setError(result.error.message ?? "Those details were not accepted.");
      setBusy(false);
      return;
    }
    // With two-factor on, the password alone does not create a session. Better
    // Auth answers with twoFactorRedirect and waits for a code.
    const data: unknown = result.data;
    if (data && typeof data === "object" && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setNeedsCode(true);
      setBusy(false);
      return;
    }
    finish();
  }

  async function onCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const trustDevice = form.get("trust") === "on";
    const result = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });

    if (result.error) {
      setError(result.error.message ?? "That code was not accepted.");
      setBusy(false);
      return;
    }
    finish();
  }

  if (needsCode) {
    return (
      <div className="auth">
        <div className="card">
          <Link href="/" className="brand">
            Stack<span>keeper</span>
          </Link>
          <h1>Enter your code</h1>

          <form className="stack" onSubmit={onCode}>
            {error ? (
              <p className="notice error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="field">
              <label htmlFor="code">
                {useBackup ? "Backup code" : "Six-digit code from your authenticator app"}
              </label>
              <input
                id="code"
                name="code"
                autoComplete="one-time-code"
                inputMode={useBackup ? "text" : "numeric"}
                required
                autoFocus
              />
            </div>

            <label className="checkbox">
              <input type="checkbox" name="trust" /> Trust this device for 30 days
            </label>

            <div className="actions">
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? "Checking…" : "Sign in"}
              </button>
              <button
                type="button"
                className="button quiet"
                onClick={() => {
                  setUseBackup(!useBackup);
                  setError(null);
                }}
              >
                {useBackup ? "Use the app instead" : "Use a backup code"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <div className="card">
        <Link href="/" className="brand">
          Stack<span>keeper</span>
        </Link>
        <h1>Sign in</h1>

        <form className="stack" onSubmit={onSubmit}>
          {error ? (
            <p className="notice error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>

          <div className="actions">
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>

        <p className="small muted" style={{ marginBlockStart: "1.5rem" }}>
          No account yet? <Link href="/sign-up">Create one</Link>.
        </p>
      </div>
    </div>
  );
}
