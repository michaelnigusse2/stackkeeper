import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { ensureSettings, type Sql } from "@stackkeeper/db";
import { tenant } from "./db";

/**
 * Who is asking, and on behalf of which organisation.
 *
 * The organisation always comes from the signed session, never from a route
 * parameter, a form field or a header. That is the single rule that makes the
 * row-level security policies meaningful: if a client could name the
 * organisation, the policies would be enforcing the attacker's choice.
 */

export interface Principal {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly orgId: string;
}

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

/**
 * The organisation a returning user should land in.
 *
 * Signing in starts a new session, and a new session has no active
 * organisation until something sets one. Without this, every sign-in would
 * look like a brand new account and send the user through onboarding again,
 * creating a duplicate workspace each time and hiding all their data.
 *
 * The oldest membership wins, so a user who has somehow ended up with several
 * workspaces returns to the first one they made, which is where their records
 * are.
 */
export async function resolveActiveOrganization(
  requestHeaders: Headers,
): Promise<string | null> {
  const organizations = await auth.api.listOrganizations({ headers: requestHeaders });
  if (!organizations || organizations.length === 0) return null;

  const oldest = [...organizations].sort((a, b) => {
    const left = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const right = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return left - right;
  })[0];

  if (!oldest) return null;

  await auth.api.setActiveOrganization({
    headers: requestHeaders,
    body: { organizationId: oldest.id },
  });

  return oldest.id;
}

/**
 * Require a signed-in user with an active organisation. A user who belongs to
 * a workspace but whose session has not been pointed at one is repaired here
 * rather than being sent to onboarding.
 */
export async function requirePrincipal(): Promise<Principal> {
  const session = await requireSession();
  let orgId = session.session.activeOrganizationId;

  if (!orgId) {
    orgId = await resolveActiveOrganization(await headers());
    if (!orgId) redirect("/onboarding");
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name ?? session.user.email,
    orgId,
  };
}

/**
 * Run work inside the caller's organisation scope.
 *
 * Prefer this over calling `tenant` with an id from anywhere else: it takes
 * the organisation from the session and hands the callback a transaction that
 * the database has already scoped.
 */
export async function withPrincipal<T>(
  work: (tx: Sql, principal: Principal) => Promise<T>,
): Promise<T> {
  const principal = await requirePrincipal();
  return tenant(principal.orgId, (tx) => work(tx, principal));
}

/** The organisation's reporting currency, creating the settings row if absent. */
export async function reportingCurrency(): Promise<string> {
  return withPrincipal(async (tx, principal) => {
    const settings = await ensureSettings(tx, principal.orgId);
    return settings.reporting_currency;
  });
}
