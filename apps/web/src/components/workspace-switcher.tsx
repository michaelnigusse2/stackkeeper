"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Only rendered when someone belongs to more than one workspace. Signing in
 * used to create a duplicate every time, so several people already have a few,
 * and there was previously no way to look inside them.
 */
export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: string;
  workspaces: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (workspaces.length < 2) return null;

  return (
    <div className="field">
      <label htmlFor="workspace" className="small muted">
        Workspace
      </label>
      <select
        id="workspace"
        defaultValue={current}
        disabled={busy}
        onChange={async (event) => {
          setBusy(true);
          await authClient.organization.setActive({ organizationId: event.target.value });
          router.push("/dashboard");
          router.refresh();
          setBusy(false);
        }}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </div>
  );
}
