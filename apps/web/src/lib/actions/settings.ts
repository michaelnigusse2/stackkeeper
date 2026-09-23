"use server";

import { revalidatePath } from "next/cache";
import { FormReader } from "@stackkeeper/core";
import { ensureSettings, recordAudit, setReportingCurrency } from "@stackkeeper/db";
import { withPrincipal } from "@/lib/session";
import { failed, invalid, type FormState } from "./state";

export async function setCurrencyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const reader = FormReader.fromFormData(formData);
  const currency = reader.currency("currency", "Currency", "USD");
  if (!reader.valid) return invalid(reader.errors);

  try {
    await withPrincipal(async (tx, principal) => {
      await ensureSettings(tx, principal.orgId);
      await setReportingCurrency(tx, principal.orgId, currency);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "settings.currency_changed",
        data: { currency },
      });
    });
  } catch (error) {
    return failed(error, "That currency could not be saved.");
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: `Totals now shown in ${currency}.` };
}
