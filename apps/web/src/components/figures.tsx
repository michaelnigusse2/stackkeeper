/**
 * A row of key numbers, each in its own small panel.
 *
 * They were deliberately unboxed for a while. The reasoning was that four
 * bordered boxes in a grid is the one thing that makes an interface look like
 * a template someone downloaded -- but what made that true was the flat page
 * underneath them. A box the same colour as the page around it is a border and
 * nothing more. Now that the page is a ground and content sits on it, a figure
 * in its own panel is a fact you can take in by itself, which is what a
 * headline number is for.
 *
 * `compact` is the record-page size: narrower panels, smaller type, because a
 * record header carries five of them above a tab strip that wants the room.
 */
export function Figures({
  compact,
  children,
}: {
  compact?: boolean;
  children: React.ReactNode;
}) {
  return <div className={compact ? "figures compact" : "figures"}>{children}</div>;
}

export function Figure({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  /** Rendered small and grey beside the value: "/mo", "· 42.8%". */
  unit?: React.ReactNode;
  note?: React.ReactNode;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="figure">
      <div className="figure-label">{label}</div>
      <div className={tone ? `figure-value ${tone}` : "figure-value"}>
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {note ? <div className="figure-note">{note}</div> : null}
    </div>
  );
}
