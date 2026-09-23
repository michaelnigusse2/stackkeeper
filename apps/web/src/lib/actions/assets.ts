"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormReader, planMonitors } from "@stackkeeper/core";
import { createAsset, ensureMonitor, recordAudit, softDeleteAsset, updateAsset } from "@stackkeeper/db";
import type { AssetKind, AssetStatus, Party } from "@stackkeeper/db";
import { withPrincipal } from "@/lib/session";
import { failed, invalid, type FormState } from "./state";

const KINDS = [
  "server", "domain", "certificate", "hosting", "dns", "email",
  "saas", "license", "cdn", "database", "storage", "other",
] as const satisfies readonly AssetKind[];

const STATUSES = [
  "active", "pending", "suspended", "cancelled", "transferred",
] as const satisfies readonly AssetStatus[];

const PARTIES = ["agency", "client", "third_party", "unknown"] as const satisfies readonly Party[];

function read(formData: FormData) {
  const reader = FormReader.fromFormData(formData);
  const expires = reader.date("expiresAt", "Expiry date");
  const input = {
    clientId: reader.uuid("clientId", "Client") ?? "",
    projectId: reader.uuid("projectId", "Project", false),
    kind: reader.choice("kind", "Type", KINDS, "other"),
    label: reader.requiredText("label", "Name", { max: 200 }),
    provider: reader.optionalText("provider", "Provider", { max: 120 }),
    identifier: reader.optionalText("identifier", "Identifier", { max: 400 }),
    region: reader.optionalText("region", "Region", { max: 120 }),
    planName: reader.optionalText("planName", "Plan", { max: 120 }),
    status: reader.choice("status", "Status", STATUSES, "active"),
    expiresAt: expires ? new Date(`${expires}T00:00:00Z`) : null,
    // The ownership register. Unknown is a real answer and the default: a
    // guess here is worse than an admission, because this is the field people
    // consult years later when a domain has to be moved.
    accountOwner: reader.choice("accountOwner", "Account owner", PARTIES, "unknown"),
    payer: reader.choice("payer", "Who pays", PARTIES, "unknown"),
    registrant: reader.choice("registrant", "Registrant", PARTIES, "unknown"),
    accessHolder: reader.choice("accessHolder", "Who holds access", PARTIES, "unknown"),
    ownershipNote: reader.optionalText("ownershipNote", "Ownership note", { max: 2000 }),
  };
  return { reader, input };
}

export async function createAssetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { reader, input } = read(formData);
  if (!reader.valid) return invalid(reader.errors);

  try {
    await withPrincipal(async (tx, principal) => {
      const asset = await createAsset(tx, principal.orgId, input);

      // Watch it straight away. Someone who has just typed in a domain has
      // already said everything needed to monitor it, and a separate "set up
      // monitoring" step is the one most people would never get round to.
      for (const planned of planMonitors(asset)) {
        await ensureMonitor(tx, principal.orgId, {
          assetId: asset.id,
          kind: planned.kind,
          target: planned.target,
        });
      }

      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "asset.created",
        targetType: "asset",
        targetId: asset.id,
        data: { kind: asset.kind, label: asset.label },
      });
    });
  } catch (error) {
    return failed(error, "The asset could not be saved.");
  }

  revalidatePath(`/clients/${input.clientId}`);
  redirect(`/clients/${input.clientId}`);
}

export async function updateAssetAction(
  assetId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { reader, input } = read(formData);
  if (!reader.valid) return invalid(reader.errors);

  try {
    const updated = await withPrincipal(async (tx, principal) => {
      const row = await updateAsset(tx, assetId, input);
      if (row) {
        // Renaming a domain changes what should be watched; add the new
        // monitors and leave the old ones for the user to remove, rather than
        // silently discarding their history.
        for (const planned of planMonitors(row)) {
          await ensureMonitor(tx, principal.orgId, {
            assetId: row.id,
            kind: planned.kind,
            target: planned.target,
          });
        }
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: "asset.updated",
          targetType: "asset",
          targetId: assetId,
        });
      }
      return row;
    });
    if (!updated) return { message: "That asset no longer exists." };
  } catch (error) {
    return failed(error, "The asset could not be saved.");
  }

  revalidatePath(`/clients/${input.clientId}`);
  redirect(`/clients/${input.clientId}`);
}

export async function deleteAssetAction(assetId: string, clientId: string): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    const removed = await softDeleteAsset(tx, assetId);
    if (removed) {
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "asset.deleted",
        targetType: "asset",
        targetId: assetId,
      });
    }
  });
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}
