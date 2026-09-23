import Link from "next/link";
import { headers } from "next/headers";
import { listOpenAlerts } from "@stackkeeper/db";
import { AccountMenu } from "@/components/account-menu";
import { GlobalSearch } from "@/components/global-search";
import { NavLink } from "@/components/nav-link";
import { SidebarToggle } from "@/components/sidebar-toggle";
import {
  BuildingIcon, ClockIcon, FolderIcon, HomeIcon, ImportIcon, PulseIcon,
  SettingsIcon, WarningIcon,
} from "@/components/icons";
import { auth } from "@/lib/auth";
import { requirePrincipal } from "@/lib/session";
import { tenant } from "@/lib/db";

/**
 * The application shell.
 *
 * A slim bar across the top carries the three things that belong to the whole
 * application -- brand, search, account -- and the sidebar below it carries
 * navigation and nothing else.
 *
 * Search started in the sidebar and did not fit: 240px less padding leaves a
 * field of about 130px, which truncated its own placeholder. Splitting the two
 * gives search real width and leaves the sidebar doing one job.
 *
 * The sidebar still collapses to an icon rail, which is what makes a sidebar
 * affordable on pages that are mostly wide tables.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every page under this layout is behind a session with an organisation.
  const principal = await requirePrincipal();

  const [openAlerts, workspaces] = await Promise.all([
    tenant(principal.orgId, (tx) => listOpenAlerts(tx, principal.orgId)),
    auth.api.listOrganizations({ headers: await headers() }).catch(() => []),
  ]);

  return (
    <div className="shell">
      <header className="appbar">
        <SidebarToggle />
        <Link href="/dashboard" className="brand">
          Stackkeeper
        </Link>

        <GlobalSearch />

        <div className="appbar-spacer" />

        <AccountMenu
          email={principal.email}
          currentWorkspace={principal.orgId}
          workspaces={(workspaces ?? []).map((w) => ({ id: w.id, name: w.name }))}
        />
      </header>

      <div className="shell-body">
        <aside className="sidebar">
          <nav className="nav" aria-label="Main">
            <div className="nav-group">
              <NavLink href="/dashboard" icon={<HomeIcon size={16} />}>
                Home
              </NavLink>
              <NavLink
                href="/alerts"
                icon={<WarningIcon size={16} />}
                after={
                  openAlerts.length > 0 ? (
                    <>
                      <span className="count-dot" aria-hidden="true" />
                      <span className="visually-hidden">
                        {openAlerts.length} open alert{openAlerts.length === 1 ? "" : "s"}
                      </span>
                    </>
                  ) : null
                }
              >
                Alerts
              </NavLink>
            </div>

            <div className="nav-group">
              <p className="nav-label">Portfolio</p>
              <NavLink href="/clients" icon={<BuildingIcon size={16} />}>
                Clients
              </NavLink>
              <NavLink href="/projects" icon={<FolderIcon size={16} />}>
                Projects
              </NavLink>
              <NavLink href="/monitors" icon={<PulseIcon size={16} />}>
                Monitors
              </NavLink>
            </div>

            <div className="nav-group">
              <p className="nav-label">Workspace</p>
              <NavLink href="/import" icon={<ImportIcon size={16} />}>
                Import
              </NavLink>
              <NavLink href="/activity" icon={<ClockIcon size={16} />}>
                Activity
              </NavLink>
              <NavLink href="/settings" icon={<SettingsIcon size={16} />}>
                Settings
              </NavLink>
            </div>
          </nav>
        </aside>

        <main className="main">{children}</main>
      </div>
    </div>
  );
}
