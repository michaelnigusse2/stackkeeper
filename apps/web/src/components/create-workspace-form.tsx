"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || `workspace-${Date.now()}`;

    const created = await authClient.organization.create({ name, slug });
    if (created.error) {
      setError(created.error.message ?? "That workspace could not be created.");
      setBusy(false);
      return;
    }

    await authClient.organization.setActive({ organizationId: created.data.id });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="name">Workspace name</label>
        <input id="name" name="name" required maxLength={100} autoFocus />
      </div>

      <div className="actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Creating…" : "Continue"}
        </button>
      </div>
    </form>
  );
}
