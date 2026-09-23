import Link from "next/link";
import { GlobeIcon, ServerIcon, ShieldIcon, WarningIcon } from "@/components/icons";
import type { Tone } from "@/components/status-dot";

/**
 * A row in the "needs attention" queue.
 *
 * This replaced a table. A table is right when you are comparing rows down a
 * column — costs, dates, margins. It is wrong for a queue, where each row is a
 * separate thing to read and decide about, and where the interesting content
 * is a sentence rather than a value. So: an icon in its status colour, the
 * sentence, what it concerns underneath, and when.
 */
export function WorklistItem({
  tone,
  rule,
  title,
  meta,
  when,
  href,
  children,
}: {
  tone: Tone;
  /** The alert rule, used only to pick the icon. */
  rule?: string;
  title: string;
  meta?: React.ReactNode;
  when?: React.ReactNode;
  href?: string;
  /** Row actions, such as acknowledge. */
  children?: React.ReactNode;
}) {
  const toneClass = tone === "unknown" ? "" : tone;
  return (
    <div className="worklist-item">
      <span className={`worklist-icon ${toneClass}`} aria-hidden="true">
        <IconForRule rule={rule} />
      </span>
      <div className="worklist-body">
        <div className="worklist-title">
          {href ? <Link href={href}>{title}</Link> : title}
        </div>
        {meta ? <div className="worklist-meta">{meta}</div> : null}
      </div>
      {when ? <span className="worklist-when">{when}</span> : null}
      {children}
    </div>
  );
}

function IconForRule({ rule }: { rule?: string }) {
  const name = rule ?? "";
  if (name.includes("tls") || name.includes("cert")) return <ShieldIcon />;
  if (name.includes("domain")) return <GlobeIcon />;
  if (name.includes("server") || name.includes("host")) return <ServerIcon />;
  return <WarningIcon />;
}
