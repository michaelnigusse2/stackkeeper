import type { JsonObject } from "@stackkeeper/core";
import type { Sql } from "../sql.ts";
import type { AssetKind, AssetRow, AssetSource, AssetStatus, Party } from "../types.ts";

export interface AssetInput {
  clientId: string;
  projectId?: string | null;
  kind: AssetKind;
  label: string;
  provider?: string | null;
  identifier?: string | null;
  region?: string | null;
  planName?: string | null;
  status?: AssetStatus;
  source?: AssetSource;
  externalId?: string | null;
  expiresAt?: Date | null;
  details?: JsonObject;
  /** The ownership register. Defaults are 'unknown', never a guess. */
  accountOwner?: Party;
  payer?: Party;
  registrant?: Party;
  accessHolder?: Party;
  ownershipNote?: string | null;
}

export interface AssetFilter {
  clientId?: string;
  projectId?: string;
  kind?: AssetKind;
}

export async function listAssets(
  tx: Sql,
  orgId: string,
  filter: AssetFilter = {},
): Promise<AssetRow[]> {
  // Filters are passed as nullable parameters rather than stitched-in SQL
  // fragments, so this stays one flat statement that scripts/check-queries.sh
  // can validate against the real schema with PREPARE.
  return tx<AssetRow[]>`
    select * from app.asset
    where org_id = ${orgId}
      and deleted_at is null
      and (${filter.clientId ?? null}::uuid is null or client_id = ${filter.clientId ?? null}::uuid)
      and (${filter.projectId ?? null}::uuid is null or project_id = ${filter.projectId ?? null}::uuid)
      and (${filter.kind ?? null}::app.asset_kind is null or kind = ${filter.kind ?? null}::app.asset_kind)
    order by kind, label
  `;
}

export async function getAsset(tx: Sql, id: string): Promise<AssetRow | null> {
  const rows = await tx<AssetRow[]>`
    select * from app.asset where id = ${id} and deleted_at is null
  `;
  return rows[0] ?? null;
}

export async function createAsset(
  tx: Sql,
  orgId: string,
  input: AssetInput,
): Promise<AssetRow> {
  const rows = await tx<AssetRow[]>`
    insert into app.asset (
      org_id, client_id, project_id, kind, label, provider, identifier,
      region, plan_name, status, source, external_id, expires_at, details,
      account_owner, payer, registrant, access_holder, ownership_note
    ) values (
      ${orgId}, ${input.clientId}, ${input.projectId ?? null}, ${input.kind},
      ${input.label}, ${input.provider ?? null}, ${input.identifier ?? null},
      ${input.region ?? null}, ${input.planName ?? null},
      ${input.status ?? "active"}, ${input.source ?? "manual"},
      ${input.externalId ?? null}, ${input.expiresAt ?? null},
      ${tx.json(input.details ?? {})},
      ${input.accountOwner ?? "unknown"}, ${input.payer ?? "unknown"},
      ${input.registrant ?? "unknown"}, ${input.accessHolder ?? "unknown"},
      ${input.ownershipNote ?? null}
    )
    returning *
  `;
  const created = rows[0];
  if (!created) throw new Error("Asset insert returned no row");
  return created;
}

export async function updateAsset(
  tx: Sql,
  id: string,
  input: AssetInput,
): Promise<AssetRow | null> {
  const rows = await tx<AssetRow[]>`
    update app.asset set
      client_id = ${input.clientId},
      project_id = ${input.projectId ?? null},
      kind = ${input.kind},
      label = ${input.label},
      provider = ${input.provider ?? null},
      identifier = ${input.identifier ?? null},
      region = ${input.region ?? null},
      plan_name = ${input.planName ?? null},
      status = ${input.status ?? "active"},
      expires_at = ${input.expiresAt ?? null},
      details = ${tx.json(input.details ?? {})},
      account_owner = ${input.accountOwner ?? "unknown"},
      payer = ${input.payer ?? "unknown"},
      registrant = ${input.registrant ?? "unknown"},
      access_holder = ${input.accessHolder ?? "unknown"},
      ownership_note = ${input.ownershipNote ?? null}
    where id = ${id} and deleted_at is null
    returning *
  `;
  return rows[0] ?? null;
}

export async function softDeleteAsset(tx: Sql, id: string): Promise<boolean> {
  const rows = await tx`
    update app.asset set deleted_at = now()
    where id = ${id} and deleted_at is null
    returning id
  `;
  return rows.length > 0;
}

/**
 * Assets whose own expiry date is approaching. Used by the dashboard before
 * the monitoring engine exists, and as a fallback for anything the engine
 * cannot check upstream, such as a .de domain whose registry publishes no
 * expiry date at all.
 */
export async function expiringAssets(
  tx: Sql,
  orgId: string,
  withinDays = 60,
): Promise<AssetRow[]> {
  return tx<AssetRow[]>`
    select * from app.asset
    where org_id = ${orgId}
      and deleted_at is null
      and expires_at is not null
      and expires_at <= now() + make_interval(days => ${withinDays})
    order by expires_at
  `;
}
