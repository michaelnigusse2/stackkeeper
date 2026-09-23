"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * One row of the sidebar.
 *
 * The label is carried in `title` as well as in the row, so that when the
 * sidebar is collapsed to icons the name still appears on hover. Without it,
 * the rail is eight unlabelled glyphs and the only way to learn them is to
 * click each one.
 */
export function NavLink({
  href,
  icon,
  after,
  children,
}: {
  href: string;
  icon?: React.ReactNode;
  /** Trailing marker, such as the unread dot on Alerts. */
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Exact match, or a child route, but never treat /clients as active for
  // /clients-something.
  const active = pathname === href || pathname.startsWith(`${href}/`);

  const label = typeof children === "string" ? children : undefined;

  return (
    <Link href={href} aria-current={active ? "page" : undefined} title={label}>
      {icon ? (
        <span className="nav-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="nav-text">{children}</span>
      {after}
    </Link>
  );
}
