"use client";

import { useActionState } from "react";
import type { AssetRow, ProjectRow } from "@stackkeeper/db";
import { FieldError, FormNotice } from "./field-error";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/lib/actions/state";

const KINDS = [
  ["domain", "Domain"], ["server", "Server"], ["hosting", "Hosting"],
  ["certificate", "Certificate"], ["dns", "DNS"], ["email", "Email"],
  ["saas", "SaaS"], ["license", "Licence"], ["cdn", "CDN"],
  ["database", "Database"], ["storage", "Storage"], ["other", "Other"],
] as const;

const PARTIES = [
  ["agency", "You"], ["client", "The client"],
  ["third_party", "A third party"], ["unknown", "Not recorded"],
] as const;

export function AssetForm({
  action,
  clientId,
  projects,
  asset,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  clientId: string;
  projects: readonly ProjectRow[];
  asset?: AssetRow;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="clientId" value={clientId} />
      <FormNotice message={state.message} tone={state.ok ? "ok" : "error"} />

      <div className="field-row">
        <div className="field">
          <label htmlFor="label">Name</label>
          <input id="label" name="label" required maxLength={200} defaultValue={asset?.label ?? ""} placeholder="acmebakery.com" />
          <FieldError errors={state.errors} name="label" />
        </div>
        <div className="field">
          <label htmlFor="kind">Type</label>
          <select id="kind" name="kind" defaultValue={asset?.kind ?? "domain"}>
            {KINDS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={asset?.status ?? "active"}>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
            <option value="transferred">Transferred</option>
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="provider">Provider</label>
          <input id="provider" name="provider" defaultValue={asset?.provider ?? ""} placeholder="Hetzner, Namecheap…" />
        </div>
        <div className="field">
          <label htmlFor="identifier">Address or identifier</label>
          <input id="identifier" name="identifier" defaultValue={asset?.identifier ?? ""} placeholder="203.0.113.10" />
        </div>
        <div className="field">
          <label htmlFor="expiresAt">Expires</label>
          <input
            id="expiresAt"
            name="expiresAt"
            type="date"
            defaultValue={asset?.expires_at ? new Date(asset.expires_at).toISOString().slice(0, 10) : ""}
          />
          <FieldError errors={state.errors} name="expiresAt" />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="region">Region</label>
          <input id="region" name="region" defaultValue={asset?.region ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="planName">Plan</label>
          <input id="planName" name="planName" defaultValue={asset?.plan_name ?? ""} placeholder="CX23" />
        </div>
        <div className="field">
          <label htmlFor="projectId">Project</label>
          <select id="projectId" name="projectId" defaultValue={asset?.project_id ?? ""}>
            <option value="">None</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="field-group">
        <legend>Ownership</legend>
        <p className="hint">
          The questions that matter when a project is handed over or a client leaves. &ldquo;Not
          recorded&rdquo; is a real answer and better than a guess.
        </p>
        <div className="field-row">
          <div className="field">
            <label htmlFor="accountOwner">Account is in the name of</label>
            <select id="accountOwner" name="accountOwner" defaultValue={asset?.account_owner ?? "unknown"}>
              {PARTIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="payer">Pays the bill</label>
            <select id="payer" name="payer" defaultValue={asset?.payer ?? "unknown"}>
              {PARTIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="registrant">Registrant of record</label>
            <select id="registrant" name="registrant" defaultValue={asset?.registrant ?? "unknown"}>
              {PARTIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="accessHolder">Holds the access</label>
            <select id="accessHolder" name="accessHolder" defaultValue={asset?.access_holder ?? "unknown"}>
              {PARTIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </div>
        </div>
        <div className="field" style={{ marginBlockStart: "0.75rem" }}>
          <label htmlFor="ownershipNote">Ownership note</label>
          <textarea id="ownershipNote" name="ownershipNote" maxLength={2000} defaultValue={asset?.ownership_note ?? ""} />
        </div>
      </fieldset>

      <div className="actions">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
