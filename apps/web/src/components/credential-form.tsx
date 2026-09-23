"use client";

import { useActionState } from "react";
import type { AssetRow } from "@stackkeeper/db";
import { createCredentialRefAction } from "@/lib/actions/credentials";
import { FieldError, FormNotice } from "./field-error";
import { SecretAwareField } from "./secret-field";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/lib/actions/state";

const REFERENCE_HINTS: Record<string, string> = {
  onepassword: 'A secret reference such as op://Shared/acme-registrar/password',
  bitwarden: "The item id from the web vault URL",
  proton_pass: "A reference such as pass://Infrastructure/web-01/ssh",
  keepassxc: "The database name and entry path",
  other: "Where to find it, in words",
};

export function CredentialForm({ clientId, assets }: { clientId: string; assets: readonly AssetRow[] }) {
  const [state, formAction] = useActionState<FormState, FormData>(createCredentialRefAction, {});

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="clientId" value={clientId} />
      <FormNotice message={state.message} tone={state.ok ? "ok" : "error"} />

      <div className="field-row">
        <div className="field">
          <label htmlFor="cred-label">What it opens</label>
          <input id="cred-label" name="label" required maxLength={200} placeholder="Registrar login" />
          <FieldError errors={state.errors} name="label" />
        </div>

        <div className="field">
          <label htmlFor="cred-asset">Asset</label>
          <select id="cred-asset" name="assetId" defaultValue="">
            <option value="">Not tied to one</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="cred-kind">Kind</label>
          <select id="cred-kind" name="kind" defaultValue="login">
            <option value="login">Login</option>
            <option value="ssh_key">SSH key</option>
            <option value="api_token">API token</option>
            <option value="totp">Two-factor</option>
            <option value="recovery_code">Recovery codes</option>
            <option value="note">Note</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="cred-manager">Kept in</label>
          <select id="cred-manager" name="manager" defaultValue="onepassword">
            <option value="onepassword">1Password</option>
            <option value="bitwarden">Bitwarden</option>
            <option value="proton_pass">Proton Pass</option>
            <option value="keepassxc">KeePassXC</option>
            <option value="dashlane">Dashlane</option>
            <option value="other">Somewhere else</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="cred-holder">Who holds it</label>
          <select id="cred-holder" name="holder" defaultValue="agency">
            <option value="agency">You</option>
            <option value="client">The client</option>
            <option value="third_party">A third party</option>
            <option value="unknown">Not recorded</option>
          </select>
        </div>
      </div>

      <SecretAwareField
        name="reference"
        label="Reference"
        hint={REFERENCE_HINTS.onepassword}
        maxLength={512}
        error={state.errors?.reference}
      />

      <SecretAwareField
        name="note"
        label="Note"
        multiline
        maxLength={2000}
        hint="Context, never the secret itself."
        error={state.errors?.note}
      />

      <div className="actions">
        <SubmitButton>Add reference</SubmitButton>
      </div>
    </form>
  );
}
