import type { Sql } from "../sql.ts";
import type { OrganizationSettingsRow } from "../types.ts";

export async function getSettings(
  tx: Sql,
  orgId: string,
): Promise<OrganizationSettingsRow | null> {
  const rows = await tx<OrganizationSettingsRow[]>`
    select * from app.organization_settings where org_id = ${orgId}
  `;
  return rows[0] ?? null;
}

/** Create the settings row the first time an organisation is used. */
export async function ensureSettings(
  tx: Sql,
  orgId: string,
  reportingCurrency = "USD",
): Promise<OrganizationSettingsRow> {
  const rows = await tx<OrganizationSettingsRow[]>`
    insert into app.organization_settings (org_id, reporting_currency)
    values (${orgId}, ${reportingCurrency})
    on conflict (org_id) do update set org_id = excluded.org_id
    returning *
  `;
  const row = rows[0];
  if (!row) throw new Error("Could not create organisation settings");
  return row;
}

export async function setReportingCurrency(
  tx: Sql,
  orgId: string,
  currency: string,
): Promise<OrganizationSettingsRow | null> {
  const rows = await tx<OrganizationSettingsRow[]>`
    update app.organization_settings set reporting_currency = ${currency}
    where org_id = ${orgId}
    returning *
  `;
  return rows[0] ?? null;
}
