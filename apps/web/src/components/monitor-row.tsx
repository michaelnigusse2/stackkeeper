"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  deleteMonitorAction, setManualExpiryAction, toggleMonitorAction,
} from "@/lib/actions/monitors";
import { StatusDot, toneForState } from "./status-dot";
import type { FormState } from "@/lib/actions/state";

export interface MonitorSummary {
  id: string;
  state: string;
  kind: string;
  target: string;
  enabled: boolean;
  lastError: string | null;
  lastCheckedAt: string | null;
  /** Already an ISO day string. Never a Date: JSX cannot render one. */
  manualExpiresAt: string | null;
  expiryIsManual: boolean;
}

const KIND_LABEL: Record<string, string> = {
  domain_expiry: "Registration",
  tls: "Certificate",
  dns: "DNS",
};

function relative(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** A short, plain summary of what the last check actually found. */
function describeCheck(kind: string, payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;

  if (kind === "tls") {
    const used = typeof payload.lifetimeUsed === "number" ? payload.lifetimeUsed : null;
    const days = typeof payload.daysRemaining === "number" ? payload.daysRemaining : null;
    const issuer = typeof payload.issuer === "string" ? payload.issuer : null;
    if (used === null) return issuer;
    return [
      issuer,
      `${Math.round(used * 100)}% of its life used`,
      days !== null ? `${days} d left` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const expires = typeof payload.expiresAt === "string" ? payload.expiresAt.slice(0, 10) : null;
  const registrar = typeof payload.registrar === "string" ? payload.registrar : null;
  const source = typeof payload.source === "string" ? payload.source : null;
  return [expires ? `expires ${expires}` : "no published expiry", registrar, source]
    .filter(Boolean)
    .join(" · ");
}

export function MonitorRow({
  monitor,
  payload,
  assetLabel,
  clientId,
}: {
  monitor: MonitorSummary;
  payload: Record<string, unknown> | null;
  assetLabel: string | null;
  clientId: string | null;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const action = setManualExpiryAction.bind(null, monitor.id);
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  const needsManualDate =
    monitor.kind === "domain_expiry" && payload?.expiryUnavailable === true;

  return (
    <tr>
      <td>
        <StatusDot
          tone={monitor.enabled ? toneForState(monitor.state) : "unknown"}
          label={monitor.enabled ? undefined : "Paused"}
        />
        {monitor.lastError ? <span className="sub">{monitor.lastError}</span> : null}
      </td>

      <td>
        <span className="mono">{monitor.target}</span>
        {monitor.expiryIsManual && monitor.manualExpiresAt ? (
          <span className="sub">
            Expiry entered by hand: {monitor.manualExpiresAt}
          </span>
        ) : null}
        {needsManualDate && !monitor.manualExpiresAt ? (
          <span className="sub">
            This registry publishes no expiry date. Add one so it can be watched.
          </span>
        ) : null}
      </td>

      <td className="muted">{KIND_LABEL[monitor.kind] ?? monitor.kind}</td>

      <td>
        {clientId ? (
          <Link href={`/clients/${clientId}`}>{assetLabel ?? "Asset"}</Link>
        ) : (
          <span className="muted">{assetLabel ?? "—"}</span>
        )}
      </td>

      <td className="muted small">
        {relative(monitor.lastCheckedAt)}
        <span className="sub">{describeCheck(monitor.kind, payload) ?? ""}</span>
      </td>

      <td className="num">
        {editing ? (
          <form action={formAction} className="row">
            <input
              type="date"
              name="expiresOn"
              defaultValue={monitor.manualExpiresAt ?? ""}
              style={{ inlineSize: "9.5rem" }}
            />
            <button type="submit" className="button small primary">
              Save
            </button>
            <button type="button" className="button small quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {state.message ? <span className="small muted">{state.message}</span> : null}
          </form>
        ) : (
          <div className="actions" style={{ justifyContent: "flex-end" }}>
            {monitor.kind === "domain_expiry" ? (
              <button type="button" className="button small quiet" onClick={() => setEditing(true)}>
                {monitor.manualExpiresAt ? "Edit date" : "Set date"}
              </button>
            ) : null}
            <button
              type="button"
              className="button small quiet"
              disabled={pending}
              onClick={() => start(() => void toggleMonitorAction(monitor.id, !monitor.enabled))}
            >
              {monitor.enabled ? "Pause" : "Resume"}
            </button>
            <button
              type="button"
              className="button small quiet"
              disabled={pending}
              onClick={() => start(() => void deleteMonitorAction(monitor.id))}
            >
              Remove
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
