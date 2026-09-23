"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormReader } from "@stackkeeper/core";
import {
  createClient, recordAudit, softDeleteClient, updateClient,
} from "@stackkeeper/db";
import { withPrincipal } from "@/lib/session";
import { failed, invalid, type FormState } from "./state";

const STATUSES = ["prospect", "active", "paused", "former"] as const;

function read(formData: FormData) {
  const reader = FormReader.fromFormData(formData);
  const input = {
    name: reader.requiredText("name", "Client name", { max: 200 }),
    status: reader.choice("status", "Status", STATUSES, "active"),
    notes: reader.optionalText("notes", "Notes", { max: 5000 }),
    primaryContactName: reader.optionalText("contactName", "Contact name", { max: 200 }),
    primaryContactEmail: reader.email("contactEmail", "Contact email"),
    primaryContactPhone: reader.optionalText("contactPhone", "Contact phone", { max: 60 }),
  };
  return { reader, input };
}

export async function createClientAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { reader, input } = read(formData);
  if (!reader.valid) return invalid(reader.errors);

  let id: string;
  try {
    id = await withPrincipal(async (tx, principal) => {
      const client = await createClient(tx, principal.orgId, input);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "client.created",
        targetType: "client",
        targetId: client.id,
        data: { name: client.name },
      });
      return client.id;
    });
  } catch (error) {
    return failed(error, "The client could not be saved.");
  }

  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

export async function updateClientAction(
  clientId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { reader, input } = read(formData);
  if (!reader.valid) return invalid(reader.errors);

  try {
    const updated = await withPrincipal(async (tx, principal) => {
      const row = await updateClient(tx, clientId, input);
      if (row) {
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: "client.updated",
          targetType: "client",
          targetId: clientId,
        });
      }
      return row;
    });
    if (!updated) return { message: "That client no longer exists." };
  } catch (error) {
    return failed(error, "The client could not be saved.");
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  redirect(`/clients/${clientId}`);
}

export async function deleteClientAction(clientId: string): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    const removed = await softDeleteClient(tx, clientId);
    if (removed) {
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "client.deleted",
        targetType: "client",
        targetId: clientId,
      });
    }
  });
  revalidatePath("/clients");
  redirect("/clients");
}
