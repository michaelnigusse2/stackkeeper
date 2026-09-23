import type { AlertEventRow, NotificationChannelRow } from "@stackkeeper/db";

/**
 * Getting an alert to a person.
 *
 * Every channel is a plain HTTP request, so there is no vendor SDK to keep up
 * to date and nothing to install. Email goes through Resend's HTTP API; Slack
 * and Discord take a webhook URL; Telegram takes a bot token and a chat id.
 *
 * The message is written for someone who is not at their desk and may be
 * reading it on a phone: what is wrong, which client it belongs to, and what
 * happens if they ignore it.
 */

export interface AlertContext {
  readonly assetLabel: string | null;
  readonly clientName: string | null;
  readonly target: string;
  readonly appUrl: string;
}

export interface FormattedAlert {
  readonly subject: string;
  readonly body: string;
  readonly url: string;
}

const SEVERITY_WORD: Record<string, string> = {
  critical: "Action needed",
  warning: "Heads up",
  info: "For information",
};

/** Turn an alert into words. Pure, so the wording can be tested. */
export function formatAlert(alert: AlertEventRow, context: AlertContext): FormattedAlert {
  const who = context.clientName ? ` for ${context.clientName}` : "";
  const what = context.assetLabel ?? context.target;
  const lead = SEVERITY_WORD[alert.severity] ?? "Notice";

  const lines = [alert.message];

  if (alert.needs_payment_confirmation) {
    lines.push(
      "",
      "The registry moves the expiry date forward automatically the day after a domain expires, " +
        "before anyone has paid. The date looks healthy but the renewal is not confirmed. " +
        "Check with the registrar.",
    );
  }

  lines.push("", `Asset: ${what}${who}`);
  // Renewal reminders come from a date the user entered, not from a check.
  if (context.target) lines.push(`Checked: ${context.target}`);

  return {
    subject: `${lead}: ${what}${who}`,
    body: lines.join("\n"),
    url: `${context.appUrl.replace(/\/$/, "")}/alerts`,
  };
}

export interface DeliveryResult {
  readonly channel: string;
  readonly ok: boolean;
  readonly detail: string | null;
}

const TIMEOUT_MS = 10_000;

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${text.slice(0, 200)}`);
  }
}

/**
 * Send one alert to one channel.
 *
 * `secret` is the decrypted webhook URL or bot token. It is passed in rather
 * than read here, so the only place that opens a sealed secret is the caller,
 * and it never ends up in a log line from this module.
 */
export async function deliver(
  channel: NotificationChannelRow,
  message: FormattedAlert,
  secret: string | null,
  options: { resendApiKey?: string | undefined; fromEmail?: string | undefined } = {},
): Promise<DeliveryResult> {
  const name = `${channel.kind}:${channel.label}`;
  try {
    switch (channel.kind) {
      case "email": {
        const to = typeof channel.config.email === "string" ? channel.config.email : null;
        if (!to) throw new Error("no address configured");
        if (!options.resendApiKey) throw new Error("RESEND_API_KEY is not set");
        await post(
          "https://api.resend.com/emails",
          {
            from: options.fromEmail ?? "Stackkeeper <alerts@example.com>",
            to: [to],
            subject: message.subject,
            text: `${message.body}\n\n${message.url}`,
          },
          { authorization: `Bearer ${options.resendApiKey}` },
        );
        break;
      }

      case "slack": {
        if (!secret) throw new Error("no webhook URL stored");
        await post(secret, { text: `*${message.subject}*\n${message.body}\n${message.url}` });
        break;
      }

      case "discord": {
        if (!secret) throw new Error("no webhook URL stored");
        await post(secret, { content: `**${message.subject}**\n${message.body}\n${message.url}` });
        break;
      }

      case "telegram": {
        if (!secret) throw new Error("no bot token stored");
        const chatId = channel.config.chatId;
        if (typeof chatId !== "string" && typeof chatId !== "number") {
          throw new Error("no chat id configured");
        }
        await post(`https://api.telegram.org/bot${secret}/sendMessage`, {
          chat_id: chatId,
          text: `${message.subject}\n\n${message.body}\n${message.url}`,
        });
        break;
      }

      case "webhook": {
        if (!secret) throw new Error("no URL stored");
        await post(secret, {
          subject: message.subject,
          body: message.body,
          url: message.url,
        });
        break;
      }
    }
    return { channel: name, ok: true, detail: null };
  } catch (error) {
    return { channel: name, ok: false, detail: (error as Error).message };
  }
}
