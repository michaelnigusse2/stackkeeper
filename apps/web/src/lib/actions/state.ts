import type { FieldErrors } from "@stackkeeper/core";

/** What every form action hands back to the form it came from. */
export interface FormState {
  readonly errors?: FieldErrors;
  readonly message?: string;
  readonly ok?: boolean;
}

export const emptyForm: FormState = {};

export function invalid(errors: FieldErrors, message?: string): FormState {
  return { errors, message: message ?? "Please check the highlighted fields." };
}

/**
 * Turn an unexpected failure into something a person can act on, without
 * leaking a stack trace or a database message into the page.
 */
export function failed(error: unknown, fallback: string): FormState {
  const constraint = describeConstraint(error);
  return { message: constraint ?? fallback };
}

function describeConstraint(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("client_org_name_idx")) {
    return "You already have a client with that name.";
  }
  if (message.includes("credential_ref_looks_like_pointer")) {
    return "That looks like a secret rather than a reference. Stackkeeper does not store secrets.";
  }
  if (message.includes("cost_line_charge_complete")) {
    return "A charge needs an amount, a currency and a billing cycle together.";
  }
  if (message.includes("asset_org_provider_external_idx")) {
    return "That asset has already been imported from this provider.";
  }
  if (message.includes("violates row-level security")) {
    return "That record belongs to a different workspace.";
  }
  return null;
}
