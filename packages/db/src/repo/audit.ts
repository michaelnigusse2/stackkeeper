import type { JsonObject } from "@stackkeeper/core";
import type { Sql } from "../sql.ts";
import type { AuditLogRow } from "../types.ts";

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  data?: JsonObject;
}

/**
 * Append to the audit log. The application role has no UPDATE or DELETE
 * privilege on this table, so history can be added to but never rewritten.
 */
export async function recordAudit(
  tx: Sql,
  orgId: string,
  entry: AuditEntry,
): Promise<void> {
  await tx`
    insert into app.audit_log (
      org_id, actor_user_id, action, target_type, target_id, ip, user_agent, data
    ) values (
      ${orgId}, ${entry.actorUserId ?? null}, ${entry.action},
      ${entry.targetType ?? null}, ${entry.targetId ?? null},
      ${entry.ip ?? null}::inet, ${entry.userAgent ?? null},
      ${tx.json(entry.data ?? {})}
    )
  `;
}

export async function listAudit(
  tx: Sql,
  orgId: string,
  limit = 100,
): Promise<AuditLogRow[]> {
  return tx<AuditLogRow[]>`
    select * from app.audit_log
    where org_id = ${orgId}
    order by created_at desc
    limit ${limit}
  `;
}
