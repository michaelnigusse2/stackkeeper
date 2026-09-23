/** Row shapes as the database returns them. Column names are snake_case. */

import type { BillingCycle, JsonObject } from "@stackkeeper/core";

export type ClientStatus = "prospect" | "active" | "paused" | "former";

export type ProjectStatus =
  | "planning" | "active" | "maintenance" | "handed_over" | "archived";

export type AssetKind =
  | "server" | "domain" | "certificate" | "hosting" | "dns" | "email"
  | "saas" | "license" | "cdn" | "database" | "storage" | "other";

export type AssetStatus = "active" | "pending" | "suspended" | "cancelled" | "transferred";

export type AssetSource = "manual" | "csv" | "import" | "discovered";

/** Who stands behind an asset. The ownership register. */
export type Party = "agency" | "client" | "third_party" | "unknown";

export type CredentialKind =
  | "login" | "ssh_key" | "api_token" | "totp" | "recovery_code" | "note" | "other";

export type CredentialManager =
  | "onepassword" | "bitwarden" | "proton_pass" | "keepassxc" | "dashlane" | "other";

export interface OrganizationSettingsRow {
  org_id: string;
  reporting_currency: string;
  plan: string;
  created_at: Date;
  updated_at: Date;
}

export interface ClientRow {
  id: string;
  org_id: string;
  name: string;
  status: ClientStatus;
  notes: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ProjectRow {
  id: string;
  org_id: string;
  client_id: string;
  name: string;
  status: ProjectStatus;
  description: string | null;
  repo_url: string | null;
  live_url: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AssetRow {
  id: string;
  org_id: string;
  client_id: string;
  project_id: string | null;
  kind: AssetKind;
  label: string;
  provider: string | null;
  identifier: string | null;
  region: string | null;
  plan_name: string | null;
  status: AssetStatus;
  source: AssetSource;
  external_id: string | null;
  expires_at: Date | null;
  details: JsonObject;
  account_owner: Party;
  payer: Party;
  registrant: Party;
  access_holder: Party;
  ownership_note: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface CostLineRow {
  id: string;
  org_id: string;
  asset_id: string;
  cost_amount: string;      // bigint arrives as a string
  cost_currency: string;
  cost_cycle: BillingCycle;
  charge_amount: string | null;
  charge_currency: string | null;
  charge_cycle: BillingCycle | null;
  billed: boolean;
  billed_via: string | null;
  // Postgres `date` columns arrive as Date objects through the driver, not
  // as strings. Typed as both so nothing downstream can assume wrongly, and
  // normalised with toIsoDate before being compared or displayed.
  next_renewal: Date | string | null;
  started_on: Date | string | null;
  ended_on: Date | string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CredentialRefRow {
  id: string;
  org_id: string;
  asset_id: string | null;
  client_id: string;
  label: string;
  kind: CredentialKind;
  manager: CredentialManager;
  reference: string | null;
  holder: Party;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLogRow {
  id: string;
  org_id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  user_agent: string | null;
  data: JsonObject;
  created_at: Date;
}

/**
 * Postgres returns bigint as a string so that values beyond 2^53 survive the
 * trip. Money in this product is minor units and stays far below that, so the
 * conversion is safe, but it is done in one place and checked.
 */
/**
 * A calendar day as "YYYY-MM-DD", whatever shape it arrived in.
 *
 * Rendering a Date straight into JSX throws, and comparing one with a string
 * using `<` quietly returns false for every row, so every date leaving this
 * layer for the interface or for a comparison goes through here.
 */
export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function toMinorUnits(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`Expected whole minor units from the database, got ${value}`);
  }
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Amount is too large to handle safely: ${value}`);
  }
  return parsed;
}
