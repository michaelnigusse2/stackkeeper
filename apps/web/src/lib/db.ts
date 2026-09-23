import "server-only";
import { createSql, withOrg, type Sql } from "@stackkeeper/db";

/**
 * Three database identities, on purpose.
 *
 *   appSql    stackkeeper_app. Owns nothing, cannot bypass row-level
 *             security, and can reach only the app schema. Every request.
 *   ownerSql  the migration owner. Maintenance and exchange-rate writes only.
 *
 * Better Auth holds a third connection of its own (see auth.ts) with access to
 * the auth schema and nothing else. Keeping the auth pool and the tenant pool
 * on separate roles means a flaw in one layer does not hand over the other.
 */

declare global {
  // eslint-disable-next-line no-var
  var __stackkeeperSql: { app?: Sql; owner?: Sql } | undefined;
}

// Reuse pools across hot reloads in development, or each edit leaks a pool.
const cache = (globalThis.__stackkeeperSql ??= {});

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

export function appSql(): Sql {
  return (cache.app ??= createSql(required("DATABASE_URL"), { max: 10 }));
}

export function ownerSql(): Sql {
  return (cache.owner ??= createSql(required("DATABASE_ADMIN_URL"), { max: 2 }));
}

/**
 * Run work scoped to one organisation. This is the only sanctioned way to
 * touch tenant data: it opens a transaction and sets the organisation for the
 * life of that transaction, so the database filters the rows rather than
 * trusting a WHERE clause somewhere up the stack.
 */
export async function tenant<T>(orgId: string, work: (tx: Sql) => Promise<T>): Promise<T> {
  return withOrg(appSql(), orgId, work);
}
