"use server";

import { revalidatePath } from "next/cache";
import { FormReader } from "@stackkeeper/core";
import {
  acknowledgeAlert, deleteMonitor, recordAudit, setManualExpiry, setMonitorEnabled,
} from "@stackkeeper/db";
import { withPrincipal } from "@/lib/session";
import { failed, invalid, type FormState } from "./state";

export async function toggleMonitorAction(monitorId: string, enabled: boolean): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    await setMonitorEnabled(tx, monitorId, enabled);
    await recordAudit(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: enabled ? "monitor.enabled" : "monitor.disabled",
      targetType: "monitor",
      targetId: monitorId,
    });
  });
  revalidatePath("/monitors");
}

export async function deleteMonitorAction(monitorId: string): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    await deleteMonitor(tx, monitorId);
    await recordAudit(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "monitor.deleted",
      targetType: "monitor",
      targetId: monitorId,
    });
  });
  revalidatePath("/monitors");
}

/**
 * Some registries publish no expiry date at all: .de and .nl do not, and .et
 * has neither a WHOIS nor an RDAP server listed with IANA. For those, a date
 * entered here is the only date there is, and the interface says so rather
 * than implying it was confirmed upstream.
 */
export async function setManualExpiryAction(
  monitorId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const reader = FormReader.fromFormData(formData);
  const expiresOn = reader.date("expiresOn", "Expiry date");
  if (!reader.valid) return invalid(reader.errors);

  try {
    await withPrincipal(async (tx, principal) => {
      await setManualExpiry(tx, monitorId, expiresOn);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "monitor.manual_expiry_set",
        targetType: "monitor",
        targetId: monitorId,
        data: { expiresOn },
      });
    });
  } catch (error) {
    return failed(error, "That date could not be saved.");
  }

  revalidatePath("/monitors");
  revalidatePath("/dashboard");
  return { ok: true, message: expiresOn ? "Date saved." : "Date cleared." };
}

export async function acknowledgeAlertAction(alertId: string): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    const done = await acknowledgeAlert(tx, alertId);
    if (done) {
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "alert.acknowledged",
        targetType: "alert_event",
        targetId: alertId,
      });
    }
  });
  revalidatePath("/alerts");
  revalidatePath("/dashboard");
}
