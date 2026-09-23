"use client";

import { useActionState } from "react";
import type { ClientRow } from "@stackkeeper/db";
import { FieldError, FormNotice } from "./field-error";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/lib/actions/state";

export function ClientForm({
  action,
  client,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  client?: ClientRow;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="stack">
      <FormNotice message={state.message} tone={state.ok ? "ok" : "error"} />

      <div className="field">
        <label htmlFor="name">Client name</label>
        <input
          id="name"
          name="name"
          required
          maxLength={200}
          defaultValue={client?.name ?? ""}
          aria-invalid={state.errors?.name ? true : undefined}
          aria-describedby={state.errors?.name ? "name-error" : undefined}
        />
        <FieldError errors={state.errors} name="name" />
      </div>

      <div className="field">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={client?.status ?? "active"}>
          <option value="prospect">Prospect</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="former">Former</option>
        </select>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="contactName">Contact name</label>
          <input id="contactName" name="contactName" defaultValue={client?.primary_contact_name ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="contactEmail">Contact email</label>
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            defaultValue={client?.primary_contact_email ?? ""}
            aria-invalid={state.errors?.contactEmail ? true : undefined}
          />
          <FieldError errors={state.errors} name="contactEmail" />
        </div>
        <div className="field">
          <label htmlFor="contactPhone">Contact phone</label>
          <input id="contactPhone" name="contactPhone" defaultValue={client?.primary_contact_phone ?? ""} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" defaultValue={client?.notes ?? ""} maxLength={5000} />
        <p className="hint">
          Context you will want years from now. Never a password: keep those in your password
          manager and add a reference to it instead.
        </p>
      </div>

      <div className="actions">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
