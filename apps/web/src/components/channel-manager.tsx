"use client";

import { useActionState, useState, useTransition } from "react";
import { createChannelAction, deleteChannelAction } from "@/lib/actions/channels";
import { FieldError, FormNotice } from "./field-error";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/lib/actions/state";

interface Channel {
  id: string;
  kind: string;
  label: string;
  enabled: boolean;
  hasSecret: boolean;
}

const KIND_LABEL: Record<string, string> = {
  email: "Email",
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
  webhook: "Webhook",
};

const TARGET_HINT: Record<string, string> = {
  email: "Where the alert should land.",
  slack: "An incoming webhook URL from a Slack app.",
  discord: "A webhook URL from the channel's integration settings.",
  telegram: "The bot token from BotFather, plus the chat id below.",
  webhook: "Any URL that accepts a JSON POST.",
};

export function ChannelManager({ channels }: { channels: readonly Channel[] }) {
  const [state, formAction] = useActionState<FormState, FormData>(createChannelAction, {});
  const [kind, setKind] = useState("email");
  const [pending, start] = useTransition();

  return (
    <div className="stack-tight">
      {channels.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Stored</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => (
                <tr key={channel.id}>
                  <td>{channel.label}</td>
                  <td className="muted">{KIND_LABEL[channel.kind] ?? channel.kind}</td>
                  <td className="muted small">
                    {channel.hasSecret ? "Encrypted, not shown" : "Address only"}
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="button small quiet"
                      disabled={pending}
                      onClick={() => start(() => void deleteChannelAction(channel.id))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <details>
        <summary>Add a channel</summary>
        <form action={formAction} className="stack">
          <FormNotice message={state.message} tone={state.ok ? "ok" : "error"} />

          <div className="field-row">
            <div className="field">
              <label htmlFor="channel-kind">Type</label>
              <select
                id="channel-kind"
                name="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                {Object.entries(KIND_LABEL).map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="channel-label">Name</label>
              <input id="channel-label" name="label" required placeholder="Owner inbox" />
              <FieldError errors={state.errors} name="label" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="channel-target">
              {kind === "email" ? "Email address" : kind === "telegram" ? "Bot token" : "Webhook URL"}
            </label>
            <input
              id="channel-target"
              name="target"
              required
              autoComplete="off"
              type={kind === "telegram" ? "password" : "text"}
              placeholder={kind === "email" ? "you@example.com" : "https://"}
            />
            <p className="hint">{TARGET_HINT[kind]}</p>
            <FieldError errors={state.errors} name="target" />
          </div>

          {kind === "telegram" ? (
            <div className="field">
              <label htmlFor="channel-chat">Chat id</label>
              <input id="channel-chat" name="chatId" placeholder="-1001234567890" />
              <FieldError errors={state.errors} name="chatId" />
            </div>
          ) : null}

          <div className="actions">
            <SubmitButton>Add channel</SubmitButton>
          </div>
        </form>
      </details>
    </div>
  );
}
