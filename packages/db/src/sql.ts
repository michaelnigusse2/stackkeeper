/**
 * Database connections.
 *
 * Two connections exist, and the difference matters:
 *
 *   ownerSql   - migrations, background maintenance, exchange-rate writes.
 *                Owns the tables. Never used to serve a request.
 *   appSql     - every request. Connects as stackkeeper_app, which owns
 *                nothing and cannot bypass row-level security.
 *
 * All tenant reads and writes go through `withOrg`, which opens a transaction
 * and sets app.org_id as a transaction-local setting. Transaction-local is the
 * point: a pooled connection handed to the next request carries nothing over,
 * because the setting dies with the transaction that set it.
 *
 * There is deliberately no way to run a tenant query outside `withOrg`. If the
 * organisation is not set, the policies return no rows rather than all rows,
 * so a mistake here shows up as an empty screen, never as another customer's
 * data.
 */

import postgres from "postgres";
import type { Sql } from "postgres";

export type { Sql };

export interface DbOptions {
  /** Maximum pooled connections. Keep small for serverless runtimes. */
  max?: number;
  /** Seconds a connection may sit idle before it is closed. */
  idleTimeout?: number;
  /** Seconds to wait for a connection before giving up. */
  connectTimeout?: number;
  onnotice?: (notice: unknown) => void;
}

export function createSql(url: string, options: DbOptions = {}): Sql {
  if (!url) throw new Error("A database URL is required");
  return postgres(url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout ?? 30,
    connect_timeout: options.connectTimeout ?? 10,
    // Notices are informational; the default handler writes them to stderr on
    // every connection, which drowns real logs.
    onnotice: options.onnotice ?? (() => {}),
    // Keep names as the database spells them. The repositories map explicitly.
    transform: { undefined: null },
  });
}

export class OrgScopeError extends Error {}

/**
 * Run a unit of work scoped to one organisation.
 *
 * Everything inside the callback sees only that organisation's rows, enforced
 * by Postgres rather than by application code remembering a WHERE clause.
 */
export async function withOrg<T>(
  sql: Sql,
  orgId: string,
  work: (tx: Sql) => Promise<T>,
): Promise<T> {
  if (typeof orgId !== "string" || orgId.trim() === "") {
    throw new OrgScopeError("withOrg needs a non-empty organisation id");
  }

  return sql.begin(async (tx) => {
    // The third argument, true, makes this transaction local.
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    return work(tx as unknown as Sql);
  }) as Promise<T>;
}

/**
 * Assert that the current transaction is scoped as expected. Cheap enough to
 * call in tests and in any code path that is about to write something
 * irreversible.
 */
export async function currentOrg(tx: Sql): Promise<string | null> {
  const rows = await tx<{ org: string | null }[]>`select app.current_org() as org`;
  return rows[0]?.org ?? null;
}
