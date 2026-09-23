"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signUp } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 12) {
      setError("Use at least 12 characters. Three or four unrelated words works well.");
      setBusy(false);
      return;
    }

    const result = await signUp.email({
      email: String(form.get("email") ?? ""),
      password,
      name: String(form.get("name") ?? ""),
    });

    if (result.error) {
      setError(result.error.message ?? "That account could not be created.");
      setBusy(false);
      return;
    }
    router.push("/onboarding");
    router.refresh();
  }

  return (
    <div className="auth">
      <div className="card">
        <Link href="/" className="brand">
          Stack<span>keeper</span>
        </Link>
        <h1>Create an account</h1>
        <p className="small muted">
          Stackkeeper records what your clients&rsquo; infrastructure costs and when it renews. It
          never stores passwords, SSH keys or API tokens.
        </p>

        <form className="stack" onSubmit={onSubmit}>
          {error ? (
            <p className="notice error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" name="name" autoComplete="name" required autoFocus />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              aria-describedby="password-hint"
            />
            <p className="hint" id="password-hint">At least 12 characters.</p>
          </div>

          <div className="actions">
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>

        <p className="small muted" style={{ marginBlockStart: "1.5rem" }}>
          Already have one? <Link href="/sign-in">Sign in</Link>.
        </p>
      </div>
    </div>
  );
}
