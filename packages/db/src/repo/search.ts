import type { Sql } from "../sql.ts";

/**
 * A single result from the global search, whatever kind of thing it is.
 *
 * Deliberately flat and uniform: the interface renders one list, so the query
 * does the work of making a client, an asset and a project look alike rather
 * than the component branching three ways.
 */
export interface SearchHit {
  kind: "client" | "project" | "asset";
  id: string;
  label: string;
  /** The line under the label: what it belongs to, or what it is. */
  context: string | null;
  /** The client this hit sits under, for building the link. */
  client_id: string | null;
  /** Lower sorts first: an exact prefix match beats a mid-word one. */
  rank: number;
}

/**
 * Escape the wildcards LIKE treats as syntax.
 *
 * Without this, typing `%` matches every row in the workspace and typing `_`
 * matches any single character -- so a search for `a_b` quietly returns `axb`.
 * Neither is a security hole, since the value is still parameterised, but both
 * are wrong answers, and `%` on its own turns a search box into "show me
 * everything" which is a slow query on a large workspace.
 *
 * The backslash must be escaped first, or escaping the others would double up
 * the backslashes this function just added.
 */
export function escapeLike(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Search clients, projects and assets by name.
 *
 * One query rather than three round trips, because the interface shows one
 * merged list and needs them ranked against each other. Soft-deleted rows are
 * excluded everywhere -- a deleted client should not come back through search.
 *
 * Row-level security still applies: this runs inside the tenant transaction
 * like every other query, so `org_id` here is belt to RLS's braces rather than
 * the only thing keeping workspaces apart.
 */
export async function searchAll(
  tx: Sql,
  orgId: string,
  term: string,
  limit = 12,
): Promise<SearchHit[]> {
  const needle = escapeLike(term.trim());
  if (needle === "") return [];

  const prefix = `${needle}%`;
  const anywhere = `%${needle}%`;

  return tx<SearchHit[]>`
    select 'client' as kind, c.id, c.name as label, c.status::text as context,
           c.id as client_id,
           case when c.name ilike ${prefix} then 0 else 1 end as rank
    from app.client c
    where c.org_id = ${orgId}
      and c.deleted_at is null
      and c.name ilike ${anywhere}

    union all

    select 'project' as kind, p.id, p.name as label, c.name as context,
           p.client_id,
           case when p.name ilike ${prefix} then 0 else 1 end as rank
    from app.project p
    join app.client c on c.org_id = p.org_id and c.id = p.client_id
    where p.org_id = ${orgId}
      and p.deleted_at is null
      and c.deleted_at is null
      and p.name ilike ${anywhere}

    union all

    select 'asset' as kind, a.id, a.label,
           coalesce(a.identifier, a.provider, c.name) as context,
           a.client_id,
           case
             when a.label ilike ${prefix} then 0
             when a.identifier ilike ${prefix} then 0
             else 1
           end as rank
    from app.asset a
    join app.client c on c.org_id = a.org_id and c.id = a.client_id
    where a.org_id = ${orgId}
      and a.deleted_at is null
      and c.deleted_at is null
      and (a.label ilike ${anywhere} or a.identifier ilike ${anywhere})

    order by rank, label
    limit ${limit}
  `;
}
