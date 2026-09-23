"use client";

import { useId, useState } from "react";
import { describeFindings, hasBlockingSecret, scanForSecrets } from "@stackkeeper/core";

/**
 * A text field that checks what you typed before it leaves the machine.
 *
 * The same scan runs again on the server, because a check that only happens in
 * the browser is not a guarantee. This one exists so the person sees the
 * promise being kept: paste a private key and it is refused here, on your own
 * computer, before anything is sent.
 */
export function SecretAwareField({
  name,
  label,
  hint,
  defaultValue = "",
  multiline = false,
  maxLength,
  error,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  multiline?: boolean;
  maxLength?: number;
  error?: string;
}) {
  const id = useId();
  const [warning, setWarning] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  function check(value: string) {
    const findings = scanForSecrets(value);
    if (findings.length === 0) {
      setWarning(null);
      setBlocked(false);
      return;
    }
    setWarning(describeFindings(findings));
    setBlocked(hasBlockingSecret(findings));
  }

  const describedBy = [warning ? `${id}-warning` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");

  const shared = {
    id,
    name,
    defaultValue,
    maxLength,
    "aria-invalid": blocked || Boolean(error) ? (true as const) : undefined,
    "aria-describedby": describedBy || undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      check(event.target.value),
  };

  return (
    <div className={`field ${blocked ? "invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea {...shared} /> : <input {...shared} />}
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {warning ? (
        <p className={blocked ? "error" : "hint"} id={`${id}-warning`} role="alert">
          {warning}
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
