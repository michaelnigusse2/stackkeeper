"use client";

import { useActionState } from "react";
import type { ClientRow, ProjectRow } from "@stackkeeper/db";
import { FieldError, FormNotice } from "./field-error";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/lib/actions/state";

export function ProjectForm({
  action,
  clients,
  project,
  defaultClientId,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  clients: readonly Pick<ClientRow, "id" | "name">[];
  project?: ProjectRow;
  defaultClientId?: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="stack">
      <FormNotice message={state.message} tone={state.ok ? "ok" : "error"} />

      <div className="field-row">
        <div className="field">
          <label htmlFor="name">Project name</label>
          <input id="name" name="name" required maxLength={200} defaultValue={project?.name ?? ""} />
          <FieldError errors={state.errors} name="name" />
        </div>

        <div className="field">
          <label htmlFor="clientId">Client</label>
          <select
            id="clientId"
            name="clientId"
            required
            defaultValue={project?.client_id ?? defaultClientId ?? ""}
            disabled={Boolean(project)}
          >
            <option value="" disabled>
              Choose a client
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <FieldError errors={state.errors} name="clientId" />
          {project ? (
            <>
              <p className="hint">A project stays with the client it was created for.</p>
              <input type="hidden" name="clientId" value={project.client_id} />
            </>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={project?.status ?? "active"}>
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="handed_over">Handed over</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="liveUrl">Live URL</label>
          <input
            id="liveUrl"
            name="liveUrl"
            inputMode="url"
            placeholder="https://acmebakery.com"
            defaultValue={project?.live_url ?? ""}
          />
          <FieldError errors={state.errors} name="liveUrl" />
        </div>
        <div className="field">
          <label htmlFor="repoUrl">Repository</label>
          <input
            id="repoUrl"
            name="repoUrl"
            inputMode="url"
            placeholder="https://github.com/..."
            defaultValue={project?.repo_url ?? ""}
          />
          <FieldError errors={state.errors} name="repoUrl" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="description">Notes</label>
        <textarea
          id="description"
          name="description"
          maxLength={5000}
          defaultValue={project?.description ?? ""}
          placeholder="What this project is, and anything the next person would need to know."
        />
      </div>

      <div className="actions">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
