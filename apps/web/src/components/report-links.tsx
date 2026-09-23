"use client";

import { useActionState, useTransition } from "react";
import {
  createReportLinkAction, revokeReportLinkAction, type ReportLinkState,
} from "@/lib/actions/report-links";
import { SubmitButton } from "./submit-button";

export interface ReportLinkView {
  readonly id: string;
  readonly label: string | null;
  readonly createdOn: string;
  readonly expiresOn: string;
  readonly live: boolean;
  readonly status: string;
  readonly views: number;
}

/**
 * Share a read-only report with a client. The new link is shown once, because
 * only its hash is stored; after that it can be revoked but not recovered.
 */
export function ReportLinks({ clientId, links }: { clientId: string; links: readonly ReportLinkView[] }) {
  const [state, formAction] = useActionState<ReportLinkState, FormData>(createReportLinkAction, {});

  return (
    <div className="stack">
      {links.length === 0 ? (
        <p className="muted small">No links yet.</p>
      ) : (
        links.map((link) => <LinkRow key={link.id} clientId={clientId} link={link} />)
      )}

      {state.url ? (
        <div className="stack-tight">
          <p className="notice ok" role="status">
            {state.message}
          </p>
          <input
            aria-label="New report link"
            className="mono"
            readOnly
            value={state.url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ) : state.message ? (
        <p className="notice error" role="alert">
          {state.message}
        </p>
      ) : null}

      <details>
        <summary>Create a link</summary>
        <form action={formAction} className="stack">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="field">
            <label htmlFor="report-label">Who it is for (optional)</label>
            <input id="report-label" name="label" maxLength={100} placeholder="Sarah, for the handover" />
          </div>
          <div className="field">
            <label htmlFor="report-days">Works for</label>
            <select id="report-days" name="days" defaultValue="30">
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
          <p className="small muted">
            Anyone with the link can see the services, renewal dates and who owns each account.
            Never costs, charges or where credentials are kept.
          </p>
          <div className="actions">
            <SubmitButton pendingLabel="Creating…">Create link</SubmitButton>
          </div>
        </form>
      </details>
    </div>
  );
}

function LinkRow({ clientId, link }: { clientId: string; link: ReportLinkView }) {
  const [pending, start] = useTransition();
  return (
    <div className="line-item">
      <div className="grow">
        <div>{link.label ?? `Created ${link.createdOn}`}</div>
        <span className="sub">
          {link.status} · viewed {link.views} time{link.views === 1 ? "" : "s"}
        </span>
      </div>
      {link.live ? (
        <button
          type="button"
          className="button small"
          disabled={pending}
          onClick={() => start(() => void revokeReportLinkAction(link.id, clientId))}
        >
          {pending ? "Revoking…" : "Revoke"}
        </button>
      ) : null}
    </div>
  );
}
