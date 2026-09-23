import { headers } from "next/headers";
import { searchAll } from "@stackkeeper/db";
import { getSession, resolveActiveOrganization } from "@/lib/session";
import { tenant } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Below this, the result list is noise; above it, a search is meaningful. */
const MIN_LENGTH = 2;

/** Nobody searches for more than this, and it bounds the query's input. */
const MAX_LENGTH = 64;

/**
 * The global search endpoint.
 *
 * Deliberately not using `requirePrincipal`: that redirects to /sign-in, which
 * is right for a page and wrong here. A fetch that receives a 302 to an HTML
 * page produces a confusing parse error in the caller instead of something it
 * can handle, so an expired session returns 401 and the search box quietly
 * shows nothing.
 *
 * The query runs inside `tenant`, so row-level security scopes it to the
 * caller's workspace regardless of what the query itself says.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ hits: [] }, { status: 401 });
  }

  const active =
    session.session.activeOrganizationId ??
    (await resolveActiveOrganization(await headers()));
  if (!active) {
    return Response.json({ hits: [] });
  }

  const term = (new URL(request.url).searchParams.get("q") ?? "")
    .trim()
    .slice(0, MAX_LENGTH);
  if (term.length < MIN_LENGTH) {
    return Response.json({ hits: [] });
  }

  const hits = await tenant(active, (tx) => searchAll(tx, active, term));

  return Response.json(
    { hits },
    // A workspace's own records; never let a proxy hold on to them.
    { headers: { "cache-control": "no-store, private" } },
  );
}
