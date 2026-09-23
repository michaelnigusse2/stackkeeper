"use server";

import { revalidatePath } from "next/cache";
import { FormReader, hasBlockingSecret, scanForSecrets, describeFindings } from "@stackkeeper/core";
import {
  createCredentialRef, deleteCredentialRef, recordAudit, updateCredentialRef,
} from "@stackkeeper/db";
import type { CredentialKind, CredentialManager, Party } from "@stackkeeper/db";
import { withPrincipal } from "@/lib/session";
import { failed, invalid, type FormState } from "./state";

const KINDS = [
  "login", "ssh_key", "api_token", "totp", "recovery_code", "note", "other",
] as const satisfies readonly CredentialKind[];

const MANAGERS = [
  "onepassword", "bitwarden", "proton_pass", "keepassxc", "dashlane", "other",
] as const satisfies readonly CredentialManager[];

const PARTIES = ["agency", "client", "third_party", "unknown"] as const satisfies readonly Party[];

function read(formData: FormData) {
  const reader = FormReader.fromFormData(formData);
  const reference = reader.optionalText("reference", "Reference", { max: 512 });
  const note = reader.optionalText("note", "Note", { max: 2000 });

  // The browser scans these fields as they are typed. This is the same check
  // on the server, because a promise enforced only in the browser is not a
  // promise. A blocked value is never written, not even redacted.
  for (const [field, value] of [["reference", reference], ["note", note]] as const) {
    if (!value) continue;
    const findings = scanForSecrets(value);
    if (hasBlockingSecret(findings)) {
      reader.errors[field] = describeFindings(findings);
    }
  }

  const input = {
    clientId: reader.uuid("clientId", "Client") ?? "",
    assetId: reader.uuid("assetId", "Asset", false),
    label: reader.requiredText("label", "Label", { max: 200 }),
    kind: reader.choice("kind", "Kind", KINDS, "login"),
    manager: reader.choice("manager", "Password manager", MANAGERS, "other"),
    reference,
    holder: reader.choice("holder", "Who holds it", PARTIES, "agency"),
    note,
  };
  return { reader, input };
}

export async function createCredentialRefAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { reader, input } = read(formData);
  if (!reader.valid) return invalid(reader.errors, "That value was not saved.");

  try {
    await withPrincipal(async (tx, principal) => {
      const ref = await createCredentialRef(tx, principal.orgId, input);
      // The label and manager are recorded; the reference itself never is.
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "credential_ref.created",
        targetType: "credential_ref",
        targetId: ref.id,
        data: { label: ref.label, manager: ref.manager },
      });
    });
  } catch (error) {
    return failed(error, "The reference could not be saved.");
  }

  revalidatePath(`/clients/${input.clientId}`);
  return { ok: true, message: "Reference saved." };
}

export async function updateCredentialRefAction(
  credentialId: string,
  clientId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { reader, input } = read(formData);
  if (!reader.valid) return invalid(reader.errors, "That value was not saved.");

  try {
    await withPrincipal(async (tx, principal) => {
      await updateCredentialRef(tx, credentialId, input);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "credential_ref.updated",
        targetType: "credential_ref",
        targetId: credentialId,
      });
    });
  } catch (error) {
    return failed(error, "The reference could not be saved.");
  }

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: "Reference saved." };
}

export async function deleteCredentialRefAction(
  credentialId: string,
  clientId: string,
): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    await deleteCredentialRef(tx, credentialId);
    await recordAudit(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "credential_ref.deleted",
      targetType: "credential_ref",
      targetId: credentialId,
    });
  });
  revalidatePath(`/clients/${clientId}`);
}
