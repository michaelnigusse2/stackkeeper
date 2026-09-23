import Link from "next/link";

/**
 * A titled region of a page: a heading, optionally a count and a link, then
 * the content, all on a panel a shade above the page.
 *
 * The panel is back after a spell without one. Stripping it removed the boxes
 * inside boxes, but it also left a page that read as a single undivided sheet
 * with headings scattered down it -- one big card, as it was put. A hairline
 * and one step of lightness is enough to say where a region starts and ends
 * without stacking borders.
 */
export function Section({
  title,
  count,
  description,
  link,
  action,
  children,
}: {
  title: string;
  /** Shown grey beside the title: how many there are in total. */
  count?: number;
  description?: React.ReactNode;
  /** A "view all" style link, right-aligned on the heading row. */
  link?: { href: string; label: string };
  /** A control on the heading row, such as a New button. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <div className="row">
            <h2>{title}</h2>
            {count !== undefined ? <span className="count">{count}</span> : null}
          </div>
          {description ? <p>{description}</p> : null}
        </div>
        {link ? (
          <Link className="small" href={link.href}>
            {link.label}
          </Link>
        ) : null}
        {action}
      </div>
      {children}
    </section>
  );
}
