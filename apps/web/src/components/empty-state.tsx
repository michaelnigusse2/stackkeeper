import Link from "next/link";

export function EmptyState({
  title,
  children,
  action,
  secondary,
}: {
  title: string;
  children?: React.ReactNode;
  action?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <div className="card empty">
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action || secondary ? (
        <div className="actions">
          {action ? (
            <Link className="button primary" href={action.href}>
              {action.label}
            </Link>
          ) : null}
          {secondary ? (
            <Link className="button" href={secondary.href}>
              {secondary.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
