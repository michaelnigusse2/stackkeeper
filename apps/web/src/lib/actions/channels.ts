"use server";

import { revalidatePath } from "next/cache";
import { FormReader, isHttpUrl } from "@stackkeeper/core";
import type { JsonObject } from "@stackkeeper/core";
import { createChannel, deleteChannel, recordAudit, secretBox } from "@stackkeeper/db";
import type { ChannelKind } from "@stackkeeper/db";
import { withPrincipal } from "@/lib/session";
import { failed, invalid, type FormState } from "./state";

const KINDS = ["email", "slack", "discord", "telegram", "webhook"] as const satisfies readonly ChannelKind[];

/**
 * A webhook URL or a bot token authenticates this service to somewhere else,
 * so it is sealed with AES-256-GCM before it is stored and never sent back to
 * the browser. It is not a user credential: Stackkeeper still stores no
 * passwords, keys or provider tokens at all.
 */
export async function createChannelAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const reader = FormReader.fromFormData(formData);
  const kind = reader.choice("kind", "Type", KINDS, "email");
  const label = reader.requiredText("label", "Name", { max: 120 });
  const target = reader.requiredText("target", targetLabel(kind), { max: 500 });
  const chatId = reader.optionalText("chatId", "Chat id", { max: 120 });

  if (kind === "email") {
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(target)) {
      reader.errors.target = "That does not look like an email address.";
    }
  } else if (kind !== "telegram" && !isHttpUrl(target)) {
    reader.errors.target = "That must be a URL starting with https://.";
  }

  if (kind === "telegram" && !chatId) {
    reader.errors.chatId = "Telegram needs a chat id as well as the bot token.";
  }

  if (!reader.valid) return invalid(reader.errors);

  try {
    await withPrincipal(async (tx, principal) => {
      const config: JsonObject = {};
      let secret: Buffer | null = null;

      if (kind === "email") {
        config.email = target;
      } else {
        secret = secretBox().seal(target);
        if (chatId) config.chatId = chatId;
      }

      const channel = await createChannel(tx, principal.orgId, { kind, label, config, secret });
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "channel.created",
        targetType: "notification_channel",
        targetId: channel.id,
        // The label and kind are recorded; the URL or token never is.
        data: { kind, label },
      });
    });
  } catch (error) {
    return failed(error, "That channel could not be saved.");
  }

  revalidatePath("/settings");
  return { ok: true, message: "Channel added." };
}

export async function deleteChannelAction(channelId: string): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    await deleteChannel(tx, channelId);
    await recordAudit(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "channel.deleted",
      targetType: "notification_channel",
      targetId: channelId,
    });
  });
  revalidatePath("/settings");
}

function targetLabel(kind: ChannelKind): string {
  switch (kind) {
    case "email": return "Email address";
    case "telegram": return "Bot token";
    default: return "Webhook URL";
  }
}
