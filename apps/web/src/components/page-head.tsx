import Link from "next/link";

/**
 * The top of a page.
 *
 * Three shapes, one component: a plain page (title and description), a list
 * view (an eyebrow naming the object, then the view's name), and a record page
 * (breadcrumb, eyebrow, the record's name, and a status line under it).
 *
 * They are one component because they are one thing visually — the eyebrow and
 * the status line are the only parts that come and go — and splitting them
 * produced three headers that drifted apart within a week.
 */
export function PageHead({
  title,
  eyebrow,
  description,
  status,
  breadcrumb,
  children,
}: {
  title: string;
  /** Small uppercase label above the title: the object this page is about. */
  eyebrow?: string;
  description?: React.ReactNode;
  /** A line under the title: status, owner, dates. Usually a StatusDot. */
  status?: React.ReactNode;
  breadcrumb?: { href: string; label: string }[];
  /** Page actions, rendered right-aligned. */
  children?: React.ReactNode;
}) {
  return (
    <>
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav className="breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((crumb, index) => (
            <span key={crumb.href}>
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              <Link href={crumb.href}>{crumb.label}</Link>
            </span>
          ))}
        </nav>
      ) : null}

      <header className="page-head">
        <div>
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h1>{title}</h1>
          {status ? <div className="head-status">{status}</div> : null}
          {description ? <p>{description}</p> : null}
        </div>
        {children ? <div className="actions">{children}</div> : null}
      </header>
    </>
  );
}
