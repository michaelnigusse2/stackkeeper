"use client";

import { useActionState } from "react";
import { BILLING_CYCLES } from "@stackkeeper/core";
import { createCostLineAction } from "@/lib/actions/cost-lines";
import { FieldError, FormNotice } from "./field-error";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/lib/actions/state";

const CYCLE_LABELS: Record<string, string> = {
  once: "One-off",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Twice a year",
  annual: "Yearly",
  biennial: "Every two years",
  triennial: "Every three years",
};

export function CostLineForm({
  assetId,
  clientId,
  defaultCurrency,
}: {
  assetId: string;
  clientId: string;
  defaultCurrency: string;
}) {
  const action = createCostLineAction.bind(null, clientId);
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="assetId" value={assetId} />
      <FormNotice message={state.message} tone={state.ok ? "ok" : "error"} />

      <div className="field-row">
        <div className="field">
          <label htmlFor={`cost-${assetId}`}>What it costs you</label>
          <input id={`cost-${assetId}`} name="costAmount" inputMode="decimal" required placeholder="5.49" />
          <FieldError errors={state.errors} name="costAmount" />
        </div>
        <div className="field">
          <label htmlFor={`cost-cur-${assetId}`}>Currency</label>
          <input id={`cost-cur-${assetId}`} name="costCurrency" defaultValue={defaultCurrency} maxLength={3} />
          <FieldError errors={state.errors} name="costCurrency" />
        </div>
        <div className="field">
          <label htmlFor={`cost-cycle-${assetId}`}>Every</label>
          <select id={`cost-cycle-${assetId}`} name="costCycle" defaultValue="monthly">
            {BILLING_CYCLES.map((cycle) => (
              <option key={cycle} value={cycle}>{CYCLE_LABELS[cycle]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor={`charge-${assetId}`}>What the client pays</label>
          <input id={`charge-${assetId}`} name="chargeAmount" inputMode="decimal" placeholder="Leave blank if not billed" />
          <FieldError errors={state.errors} name="chargeAmount" />
        </div>
        <div className="field">
          <label htmlFor={`charge-cur-${assetId}`}>Currency</label>
          <input id={`charge-cur-${assetId}`} name="chargeCurrency" defaultValue={defaultCurrency} maxLength={3} />
        </div>
        <div className="field">
          <label htmlFor={`charge-cycle-${assetId}`}>Every</label>
          <select id={`charge-cycle-${assetId}`} name="chargeCycle" defaultValue="monthly">
            {BILLING_CYCLES.map((cycle) => (
              <option key={cycle} value={cycle}>{CYCLE_LABELS[cycle]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor={`renewal-${assetId}`}>Next renewal</label>
          <input id={`renewal-${assetId}`} name="nextRenewal" type="date" />
          <FieldError errors={state.errors} name="nextRenewal" />
        </div>
        <div className="field">
          <label htmlFor={`billedvia-${assetId}`}>Billed through</label>
          <input id={`billedvia-${assetId}`} name="billedVia" placeholder="Invoice, retainer…" />
        </div>
        <div className="field" style={{ justifyContent: "end" }}>
          <div className="checkbox">
            <input id={`billed-${assetId}`} name="billed" type="checkbox" />
            <label htmlFor={`billed-${assetId}`}>Already invoiced</label>
          </div>
        </div>
      </div>

      <div className="actions">
        <SubmitButton>Save costs</SubmitButton>
      </div>
    </form>
  );
}
