"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    router.push("/dashboard");
    router.refresh();
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
