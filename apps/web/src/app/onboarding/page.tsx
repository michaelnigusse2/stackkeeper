import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CreateWorkspaceForm } from "@/components/create-workspace-form";
import { requireSession, resolveActiveOrganization } from "@/lib/session";

/**
 * Onboarding is only for someone with no workspace at all.
 *
 * Anyone who already belongs to one is sent straight in, with their session
 * pointed at it. Without this check, a returning user whose session had not
 * been given an active organisation would be invited to create a second
 * workspace, and their existing records would appear to have vanished.
 */
export default async function OnboardingPage() {
  await requireSession();

  const existing = await resolveActiveOrganization(await headers());
  if (existing) redirect("/dashboard");

  return (
    <div className="auth">
      <div className="card">
        <Link href="/" className="brand">
          Stack<span>keeper</span>
        </Link>
        <h1>Name your workspace</h1>
        <p className="small muted">
          Usually your business name. Everything you track lives inside it, and you can invite
          colleagues later.
        </p>
        <CreateWorkspaceForm />
      </div>
    </div>
  );
}
