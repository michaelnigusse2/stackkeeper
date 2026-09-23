export type Tone = "ok" | "warning" | "critical" | "info" | "unknown";

const LABELS: Record<Tone, string> = {
  ok: "Healthy",
  warning: "Needs attention",
  critical: "Urgent",
  info: "Information",
  unknown: "Not checked yet",
};

/**
 * Status is carried by a dot *and* a word. Colour alone would be unreadable
 * for anyone who cannot distinguish red from green, which is roughly one man
 * in twelve.
 *
 * The tone goes on both the wrapper and the dot: the wrapper colours the word,
 * the dot colours itself. `unknown` is deliberately left uncoloured so that a
 * thing nobody has checked yet does not read as a thing that is fine.
 */
export function StatusDot({ tone, label }: { tone: Tone; label?: string }) {
  const toneClass = tone === "unknown" ? "quiet" : tone;
  return (
    <span className={`status ${toneClass}`}>
      <span className={`dot ${toneClass}`} aria-hidden="true" />
      {label ?? LABELS[tone]}
    </span>
  );
}

export function toneForState(state: string): Tone {
  if (state === "ok" || state === "critical" || state === "warning") return state;
  if (state === "error") return "critical";
  return "unknown";
}
