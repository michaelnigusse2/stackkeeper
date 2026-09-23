"use server";

import { revalidatePath } from "next/cache";
import { FormReader } from "@stackkeeper/core";
import {
  createCostLine, deleteCostLine, markBilled, recordAudit, updateCostLine,
} from "@stackkeeper/db";
import { withPrincipal } from "@/lib/session";
import { failed, invalid, type FormState } from "./state";

function read(formData: FormData) {
  const reader = FormReader.fromFormData(formData);
  const costCurrency = reader.currency("costCurrency", "Cost currency", "USD");
  const cost = reader.money("costAmount", "Cost", costCurrency);

  // A charge is optional. Leaving it blank is exactly the case the product is
  // built to surface: a service you pay for and nobody is billed for.
  const chargeRaw = (formData.get("chargeAmount") ?? "").toString().trim();
  const chargeCurrency = reader.currency("chargeCurrency", "Charge currency", costCurrency);
  const charge = chargeRaw === "" ? null : reader.money("chargeAmount", "Charge", chargeCurrency, false);

  const input = {
    assetId: reader.uuid("assetId", "Asset") ?? "",
    costAmount: cost?.amount ?? 0,
    costCurrency,
    costCycle: reader.cycle("costCycle", "Cost cycle", "monthly"),
    chargeAmount: charge?.amount ?? null,
    chargeCurrency: charge ? chargeCurrency : null,
    chargeCycle: charge ? reader.cycle("chargeCycle", "Charge cycle", "monthly") : null,
    billed: reader.boolean("billed"),
    billedVia: reader.optionalText("billedVia", "Billed through", { max: 120 }),
    nextRenewal: reader.date("nextRenewal", "Next renewal"),
    startedOn: reader.date("startedOn", "Started on"),
    endedOn: reader.date("endedOn", "Ended on"),
    note: reader.optionalText("note", "Note", { max: 2000 }),
  };
  return { reader, input };
}

export async function createCostLineAction(
  clientId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { reader, input } = read(formData);
  if (!reader.valid) return invalid(reader.errors);

  try {
    await withPrincipal(async (tx, principal) => {
      const line = await createCostLine(tx, principal.orgId, input);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "cost_line.created",
        targetType: "cost_line",
        targetId: line.id,
      });
    });
  } catch (error) {
    return failed(error, "The cost line could not be saved.");
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { ok: true, message: "Saved." };
}

export async function updateCostLineAction(
  costLineId: string,
  clientId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { reader, input } = read(formData);
  if (!reader.valid) return invalid(reader.errors);

  try {
    await withPrincipal(async (tx, principal) => {
      await updateCostLine(tx, costLineId, input);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "cost_line.updated",
        targetType: "cost_line",
        targetId: costLineId,
      });
    });
  } catch (error) {
    return failed(error, "The cost line could not be saved.");
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { ok: true, message: "Saved." };
}

export async function toggleBilledAction(
  costLineId: string,
  clientId: string,
  billed: boolean,
): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    await markBilled(tx, costLineId, billed);
    await recordAudit(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: billed ? "cost_line.marked_billed" : "cost_line.marked_unbilled",
      targetType: "cost_line",
      targetId: costLineId,
    });
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
}

export async function deleteCostLineAction(
  costLineId: string,
  clientId: string,
): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    await deleteCostLine(tx, costLineId);
    await recordAudit(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "cost_line.deleted",
      targetType: "cost_line",
      targetId: costLineId,
    });
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
}
