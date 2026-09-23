import type { Sql } from "../sql.ts";
import type { ProjectRow, ProjectStatus } from "../types.ts";

export interface ProjectInput {
  clientId: string;
  name: string;
  status?: ProjectStatus;
  description?: string | null;
  repoUrl?: string | null;
  liveUrl?: string | null;
}

export async function listProjects(
  tx: Sql,
  orgId: string,
  clientId?: string,
): Promise<ProjectRow[]> {
  if (clientId) {
    return tx<ProjectRow[]>`
      select * from app.project
      where org_id = ${orgId} and client_id = ${clientId} and deleted_at is null
      order by name
    `;
  }
  return tx<ProjectRow[]>`
    select * from app.project
    where org_id = ${orgId} and deleted_at is null
    order by name
  `;
}

export async function getProject(tx: Sql, id: string): Promise<ProjectRow | null> {
  const rows = await tx<ProjectRow[]>`
    select * from app.project where id = ${id} and deleted_at is null
  `;
  return rows[0] ?? null;
}

export async function createProject(
  tx: Sql,
  orgId: string,
  input: ProjectInput,
): Promise<ProjectRow> {
  const rows = await tx<ProjectRow[]>`
    insert into app.project (org_id, client_id, name, status, description, repo_url, live_url)
    values (
      ${orgId}, ${input.clientId}, ${input.name}, ${input.status ?? "active"},
      ${input.description ?? null}, ${input.repoUrl ?? null}, ${input.liveUrl ?? null}
    )
    returning *
  `;
  const created = rows[0];
  if (!created) throw new Error("Project insert returned no row");
  return created;
}

export async function updateProject(
  tx: Sql,
  id: string,
  input: Omit<ProjectInput, "clientId">,
): Promise<ProjectRow | null> {
  const rows = await tx<ProjectRow[]>`
    update app.project set
      name = ${input.name},
      status = ${input.status ?? "active"},
      description = ${input.description ?? null},
      repo_url = ${input.repoUrl ?? null},
      live_url = ${input.liveUrl ?? null}
    where id = ${id} and deleted_at is null
    returning *
  `;
  return rows[0] ?? null;
}

export async function softDeleteProject(tx: Sql, id: string): Promise<boolean> {
  const rows = await tx`
    update app.project set deleted_at = now()
    where id = ${id} and deleted_at is null
    returning id
  `;
  return rows.length > 0;
}
