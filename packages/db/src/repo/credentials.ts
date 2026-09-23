import type { Sql } from "../sql.ts";
import type { CredentialKind, CredentialManager, CredentialRefRow, Party } from "../types.ts";

export interface CredentialRefInput {
  clientId: string;
  assetId?: string | null;
  label: string;
  kind?: CredentialKind;
  manager?: CredentialManager;
  /**
   * A pointer into the user's password manager: an op:// reference, a
   * Bitwarden item id, a pass:// reference. Never a secret. The browser scans
   * this field before it is submitted, and a database constraint rejects the
   * most obvious paste of a private key.
   */
  reference?: string | null;
  holder?: Party;
  note?: string | null;
}

export async function listCredentialRefs(
  tx: Sql,
  orgId: string,
  clientId: string,
): Promise<CredentialRefRow[]> {
  return tx<CredentialRefRow[]>`
    select * from app.credential_ref
    where org_id = ${orgId} and client_id = ${clientId}
    order by label
  `;
}

export async function listCredentialRefsForAsset(
  tx: Sql,
  assetId: string,
): Promise<CredentialRefRow[]> {
  return tx<CredentialRefRow[]>`
    select * from app.credential_ref where asset_id = ${assetId} order by label
  `;
}

export async function createCredentialRef(
  tx: Sql,
  orgId: string,
  input: CredentialRefInput,
): Promise<CredentialRefRow> {
  const rows = await tx<CredentialRefRow[]>`
    insert into app.credential_ref (
      org_id, client_id, asset_id, label, kind, manager, reference, holder, note
    ) values (
      ${orgId}, ${input.clientId}, ${input.assetId ?? null}, ${input.label},
      ${input.kind ?? "login"}, ${input.manager ?? "other"},
      ${input.reference ?? null}, ${input.holder ?? "agency"}, ${input.note ?? null}
    )
    returning *
  `;
  const created = rows[0];
  if (!created) throw new Error("Credential reference insert returned no row");
  return created;
}

export async function updateCredentialRef(
  tx: Sql,
  id: string,
  input: Omit<CredentialRefInput, "clientId">,
): Promise<CredentialRefRow | null> {
  const rows = await tx<CredentialRefRow[]>`
    update app.credential_ref set
      asset_id = ${input.assetId ?? null},
      label = ${input.label},
      kind = ${input.kind ?? "login"},
      manager = ${input.manager ?? "other"},
      reference = ${input.reference ?? null},
      holder = ${input.holder ?? "agency"},
      note = ${input.note ?? null}
    where id = ${id}
    returning *
  `;
  return rows[0] ?? null;
}

export async function deleteCredentialRef(tx: Sql, id: string): Promise<boolean> {
  const rows = await tx`delete from app.credential_ref where id = ${id} returning id`;
  return rows.length > 0;
}
