"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  describeFindings, FormReader, hasBlockingSecret, REPORT_LINK_DAYS, scanForSecrets,
} from "@stackkeeper/core";
import { createReportLink, getClient, recordAudit, revokeReportLink } from "@stackkeeper/db";
import { withPrincipal } from "@/lib/session";

export interface ReportLinkState {
  readonly message?: string;
  readonly ok?: boolean;
  /** The full link. Shown once: only its hash is stored. */
  readonly url?: string;
}

/** Where links point: the configured public URL, else the host of this request. */
async function baseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
  if (configured) return configured.replace(/\/$/, "");
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

export async function createReportLinkAction(
  _previous: ReportLinkState,
  formData: FormData,
): Promise<ReportLinkState> {
  const reader = FormReader.fromFormData(formData);
  const clientId = reader.uuid("clientId", "Client") ?? "";
  const label = reader.optionalText("label", "Label", { max: 100 });
  const days = Number(formData.get("days"));
  if (!(REPORT_LINK_DAYS as readonly number[]).includes(days)) {
    return { message: "Choose how long the link should work." };
  }
  if (label && hasBlockingSecret(scanForSecrets(label))) {
    return { message: describeFindings(scanForSecrets(label)) };
  }
  if (!reader.valid) return { message: "That link was not created." };

  // 256 random bits; the database only ever sees the SHA-256 of this.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest();
  const expiresAt = new Date(Date.now() + days * 86_400_000);

  try {
    const created = await withPrincipal(async (tx, principal) => {
      const client = await getClient(tx, clientId);
      if (!client) return false;
      const link = await createReportLink(tx, principal.orgId, {
        clientId,
        tokenHash,
        expiresAt,
        label,
        createdBy: principal.userId,
      });
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "report_link.created",
        targetType: "client",
        targetId: clientId,
        data: { linkId: link.id, days },
      });
      return true;
    });
    if (!created) return { message: "That client could not be found." };
  } catch {
    return { message: "The link could not be created. Try again." };
  }

  revalidatePath(`/clients/${clientId}`);
  return {
    ok: true,
    url: `${await baseUrl()}/r/${token}`,
    message: `Copy this link now. It works for ${days} days and will not be shown again.`,
  };
}

export async function revokeReportLinkAction(linkId: string, clientId: string): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    const done = await revokeReportLink(tx, linkId);
    if (done) {
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "report_link.revoked",
        targetType: "client",
        targetId: clientId,
        data: { linkId },
      });
    }
  });
  revalidatePath(`/clients/${clientId}`);
}
