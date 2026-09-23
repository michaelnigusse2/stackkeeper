import type { Sql } from "../sql.ts";

/**
 * Shareable, read-only client report links.
 *
 * Only the SHA-256 hash of a token is stored. The token itself exists in the
 * URL handed to the client and nowhere else, so it is shown once, at creation.
 */

export interface ReportLinkRow {
  id: string;
  org_id: string;
  client_id: string;
  label: string | null;
  created_by: string | null;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  last_viewed_at: Date | null;
  view_count: number;
}

export async function createReportLink(
  tx: Sql,
  orgId: string,
  input: {
    clientId: string;
    tokenHash: Uint8Array;
    expiresAt: Date;
    label?: string | null;
    createdBy?: string | null;
  },
): Promise<ReportLinkRow> {
  const [row] = await tx<ReportLinkRow[]>`
    insert into app.client_report_link (org_id, client_id, token_hash, expires_at, label, created_by)
    values (
      ${orgId}, ${input.clientId}, ${Buffer.from(input.tokenHash)}, ${input.expiresAt},
      ${input.label ?? null}, ${input.createdBy ?? null}
    )
    -- Every column except the hash, which never needs to leave the database.
    returning id, org_id, client_id, label, created_by, created_at, expires_at, revoked_at,
              last_viewed_at, view_count
  `;
  if (!row) throw new Error("Report link insert returned no row");
  return row;
}

/** Links for one client, live ones first. */
export async function listReportLinks(
  tx: Sql,
  orgId: string,
  clientId: string,
): Promise<ReportLinkRow[]> {
  return tx<ReportLinkRow[]>`
    select id, org_id, client_id, label, created_by, created_at, expires_at, revoked_at,
           last_viewed_at, view_count
    from app.client_report_link
    where org_id = ${orgId} and client_id = ${clientId}
    order by (revoked_at is null and expires_at > now()) desc, created_at desc
    limit 50
  `;
}

export async function revokeReportLink(tx: Sql, linkId: string): Promise<boolean> {
  const rows = await tx`
    update app.client_report_link set revoked_at = now()
    where id = ${linkId} and revoked_at is null
    returning id
  `;
  return rows.length > 0;
}

export interface ResolvedReportLink {
  org_id: string;
  client_id: string;
  link_id: string;
  expires_at: Date;
}

/**
 * Look a token's hash up without an organisation, through the one narrow
 * database function built for it (migration 0005). Returns null for unknown,
 * revoked and expired links alike, and counts the view when it matches.
 */
export async function resolveReportLink(
  sql: Sql,
  tokenHash: Uint8Array,
): Promise<ResolvedReportLink | null> {
  const rows = await sql<ResolvedReportLink[]>`
    select * from app.resolve_report_link(${Buffer.from(tokenHash)})
  `;
  return rows[0] ?? null;
}
