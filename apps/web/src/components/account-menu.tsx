"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient, signOut } from "@/lib/auth-client";
import { ChevronDownIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The account menu in the global header: who you are signed in as, which
 * workspace you are looking at, the appearance choice, and the way out.
 *
 * These were four separate things pinned to the bottom of the old sidebar.
 * With navigation moved to the top there is no sidebar to pin them to, and
 * they are all "about me" rather than "about the data", so they belong
 * together behind one control.
 */
export function AccountMenu({
  email,
  currentWorkspace,
  workspaces,
  placement = "down",
}: {
  email: string;
  currentWorkspace: string;
  workspaces: readonly { id: string; name: string }[];
  /** "up" when the trigger sits at the bottom of the sidebar. */
  placement?: "up" | "down";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Close on a click anywhere else, and on Escape. Both listeners are attached
  // only while the menu is open, so a closed menu costs nothing.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initials = initialsFor(email);
  const current = workspaces.find((workspace) => workspace.id === currentWorkspace);

  return (
    <div className="account" ref={wrapper}>
      <button
        type="button"
        className="account-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="account-email truncate">{email}</span>
        <span className="visually-hidden">Account and settings</span>
        <ChevronDownIcon />
      </button>

      {open ? (
        <div className={placement === "up" ? "menu up" : "menu"} role="menu">
          <div className="menu-head">
            <span className="small truncate">{email}</span>
            {current ? <span className="note truncate">{current.name}</span> : null}
          </div>

          {workspaces.length > 1 ? (
            <div className="menu-section">
              <label htmlFor="workspace" className="menu-label">
                Workspace
              </label>
              <select
                id="workspace"
                defaultValue={currentWorkspace}
                disabled={busy}
                onChange={async (event) => {
                  setBusy(true);
                  await authClient.organization.setActive({
                    organizationId: event.target.value,
                  });
                  setOpen(false);
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
          ) : null}

          <div className="menu-section">
            <span className="menu-label">Appearance</span>
            <ThemeToggle />
          </div>

          <div className="menu-section">
            <button
              type="button"
              className="button quiet small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await signOut();
                router.push("/sign-in");
                router.refresh();
              }}
            >
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Two letters from an email address, for the avatar. */
function initialsFor(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}
