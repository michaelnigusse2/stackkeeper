import type { Sql } from "../sql.ts";
import type { ClientRow, ClientStatus } from "../types.ts";

export interface ClientInput {
  name: string;
  status?: ClientStatus;
  notes?: string | null;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
}

export interface ClientSummary extends ClientRow {
  asset_count: number;
  project_count: number;
}

export async function listClients(tx: Sql, orgId: string): Promise<ClientSummary[]> {
  const rows = await tx<Array<ClientRow & { asset_count: string; project_count: string }>>`
    select c.*,
           coalesce(a.n, 0) as asset_count,
           coalesce(p.n, 0) as project_count
    from app.client c
    left join lateral (
      select count(*) as n from app.asset a
      where a.org_id = c.org_id and a.client_id = c.id and a.deleted_at is null
    ) a on true
    left join lateral (
      select count(*) as n from app.project p
      where p.org_id = c.org_id and p.client_id = c.id and p.deleted_at is null
    ) p on true
    where c.org_id = ${orgId} and c.deleted_at is null
    order by c.name
  `;
  return rows.map((row) => ({
    ...row,
    asset_count: Number(row.asset_count),
    project_count: Number(row.project_count),
  }));
}

export async function getClient(tx: Sql, id: string): Promise<ClientRow | null> {
  const rows = await tx<ClientRow[]>`
    select * from app.client where id = ${id} and deleted_at is null
  `;
  return rows[0] ?? null;
}

export async function createClient(
  tx: Sql,
  orgId: string,
  input: ClientInput,
): Promise<ClientRow> {
  const rows = await tx<ClientRow[]>`
    insert into app.client (
      org_id, name, status, notes,
      primary_contact_name, primary_contact_email, primary_contact_phone
    ) values (
      ${orgId}, ${input.name}, ${input.status ?? "active"}, ${input.notes ?? null},
      ${input.primaryContactName ?? null}, ${input.primaryContactEmail ?? null},
      ${input.primaryContactPhone ?? null}
    )
    returning *
  `;
  const created = rows[0];
  if (!created) throw new Error("Client insert returned no row");
  return created;
}

export async function updateClient(
  tx: Sql,
  id: string,
  input: ClientInput,
): Promise<ClientRow | null> {
  const rows = await tx<ClientRow[]>`
    update app.client set
      name = ${input.name},
      status = ${input.status ?? "active"},
      notes = ${input.notes ?? null},
      primary_contact_name = ${input.primaryContactName ?? null},
      primary_contact_email = ${input.primaryContactEmail ?? null},
      primary_contact_phone = ${input.primaryContactPhone ?? null}
    where id = ${id} and deleted_at is null
    returning *
  `;
  return rows[0] ?? null;
}

/**
 * Soft delete. The row stays for thirty days so that an accidental deletion is
 * recoverable, then a purge job removes it. This is also how a data deletion
 * request is served: mark now, erase on schedule.
 */
export async function softDeleteClient(tx: Sql, id: string): Promise<boolean> {
  const rows = await tx`
    update app.client set deleted_at = now()
    where id = ${id} and deleted_at is null
    returning id
  `;
  return rows.length > 0;
}
