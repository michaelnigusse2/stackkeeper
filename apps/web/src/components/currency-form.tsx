"use client";

import { useActionState } from "react";
import { setCurrencyAction } from "@/lib/actions/settings";
import { FieldError, FormNotice } from "./field-error";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/lib/actions/state";

const COMMON = ["USD", "EUR", "GBP", "ETB", "CAD", "AUD", "CHF", "SEK", "INR", "ZAR", "KES", "NGN"];

export function CurrencyForm({ current }: { current: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(setCurrencyAction, {});

  return (
    <form action={formAction} className="stack">
      <FormNotice message={state.message} tone={state.ok ? "ok" : "error"} />
      <div className="field">
        <label htmlFor="currency">Currency</label>
        <input
          id="currency"
          name="currency"
          list="common-currencies"
          defaultValue={current}
          maxLength={3}
          style={{ maxInlineSize: "8rem", textTransform: "uppercase" }}
        />
        <datalist id="common-currencies">
          {COMMON.map((code) => (
            <option key={code} value={code} />
          ))}
        </datalist>
        <FieldError errors={state.errors} name="currency" />
      </div>
      <div className="actions">
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}
