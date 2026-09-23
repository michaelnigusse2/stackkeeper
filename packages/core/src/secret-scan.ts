/**
 * Secret scanner.
 *
 * Stackkeeper promises never to store passwords, SSH keys or API tokens. This
 * turns that promise into behaviour the user can see: free-text fields are
 * scanned in the browser before anything is sent, so a pasted private key is
 * caught on the machine it was pasted on.
 *
 * Two deliberate biases:
 *   1. Pointers into a password manager must never be flagged. A Bitwarden
 *      item id is a random-looking string, and warning about it every time
 *      would teach users to ignore the warnings.
 *   2. High-confidence patterns block; the entropy heuristic only warns.
 *      A false block on a legitimate note is worse than a soft nudge.
 */

export type SecretSeverity = "block" | "warn";

export interface SecretFinding {
  readonly kind: string;
  readonly label: string;
  readonly severity: SecretSeverity;
  readonly index: number;
  readonly length: number;
  /** A redacted excerpt, safe to show in an error message or a log. */
  readonly preview: string;
}

interface Rule {
  readonly kind: string;
  readonly label: string;
  readonly severity: SecretSeverity;
  readonly pattern: RegExp;
}

const RULES: readonly Rule[] = [
  {
    kind: "private_key",
    label: "a private key block",
    severity: "block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    kind: "putty_private_key",
    label: "a PuTTY private key",
    severity: "block",
    pattern: /PuTTY-User-Key-File-\d/g,
  },
  {
    kind: "aws_access_key_id",
    label: "an AWS access key id",
    severity: "block",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    kind: "github_token",
    label: "a GitHub token",
    severity: "block",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g,
  },
  {
    kind: "slack_token",
    label: "a Slack token",
    severity: "block",
    pattern: /\bxox[baprse]-[A-Za-z0-9-]{10,}/g,
  },
  {
    kind: "slack_webhook",
    label: "a Slack webhook URL",
    severity: "block",
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/+_-]{20,}/g,
  },
  {
    kind: "discord_webhook",
    label: "a Discord webhook URL",
    severity: "block",
    pattern: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}/g,
  },
  {
    kind: "stripe_key",
    label: "a Stripe secret key",
    severity: "block",
    pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    kind: "google_api_key",
    label: "a Google API key",
    severity: "block",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    kind: "digitalocean_token",
    label: "a DigitalOcean token",
    severity: "block",
    pattern: /\bdop_v1_[a-f0-9]{64}\b/g,
  },
  {
    kind: "npm_token",
    label: "an npm token",
    severity: "block",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
  },
  {
    kind: "telegram_bot_token",
    label: "a Telegram bot token",
    severity: "block",
    pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
  },
  {
    kind: "jwt",
    label: "a JSON web token",
    severity: "block",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    kind: "connection_string_password",
    label: "a connection string with a password in it",
    severity: "block",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{3,}@[^\s/]+/g,
  },
  {
    kind: "assigned_secret",
    label: "something that reads like an assigned password or token",
    severity: "warn",
    pattern: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?\S{6,}/gi,
  },
];

/**
 * Shapes that look random but are legitimate references into a password
 * manager. Checked against each candidate before the entropy heuristic runs.
 */
const POINTER_PATTERNS: readonly RegExp[] = [
  /^op:\/\/[^\s]+$/i,
  /^pass:\/\/[^\s]+$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^https:\/\/(?:vault\.bitwarden\.com|vault\.bitwarden\.eu|start\.1password\.com|[\w.-]+\.1password\.com)\//i,
  /^onepassword:\/\//i,
];

export function looksLikePointer(candidate: string): boolean {
  return POINTER_PATTERNS.some((p) => p.test(candidate.trim()));
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function redact(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 8) return "*".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}…${"*".repeat(4)}${trimmed.slice(-2)}`;
}

/**
 * Entropy heuristic for tokens no named rule caught.
 *
 * Threshold notes: uniform hexadecimal tops out at 4.0 bits per character, so
 * 4.2 excludes certificate fingerprints, commit hashes and UUIDs by
 * construction, while random base64 secrets sit near 5.
 */
function entropyFindings(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const tokenPattern = /[A-Za-z0-9+/=_-]{32,}/g;

  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    if (looksLikePointer(token)) continue;
    if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) continue;
    if (shannonEntropy(token) <= 4.2) continue;

    findings.push({
      kind: "high_entropy_string",
      label: "a long random-looking string, which may be a key or token",
      severity: "warn",
      index: match.index,
      length: token.length,
      preview: redact(token),
    });
  }
  return findings;
}

/**
 * Scan free text for secrets. Returns every finding, most severe first.
 * Pure and synchronous, so it can run on each keystroke in a form.
 */
export function scanForSecrets(text: string): SecretFinding[] {
  if (!text) return [];
  if (looksLikePointer(text)) return [];

  const findings: SecretFinding[] = [];
  const covered: Array<[number, number]> = [];

  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        kind: rule.kind,
        label: rule.label,
        severity: rule.severity,
        index: match.index,
        length: match[0].length,
        preview: redact(match[0]),
      });
      covered.push([match.index, match.index + match[0].length]);
    }
  }

  // Do not report the same span twice through the generic heuristic.
  for (const finding of entropyFindings(text)) {
    const overlaps = covered.some(
      ([start, end]) => finding.index < end && finding.index + finding.length > start,
    );
    if (!overlaps) findings.push(finding);
  }

  return findings.sort((a, b) =>
    a.severity === b.severity ? a.index - b.index : a.severity === "block" ? -1 : 1,
  );
}

export function hasBlockingSecret(findings: readonly SecretFinding[]): boolean {
  return findings.some((f) => f.severity === "block");
}

/** One sentence for the form, naming what was found without repeating it. */
export function describeFindings(findings: readonly SecretFinding[]): string {
  if (findings.length === 0) return "";
  const labels = [...new Set(findings.map((f) => f.label))];
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return hasBlockingSecret(findings)
    ? `This looks like ${list}. Stackkeeper does not store secrets: keep it in your password manager and save a reference here instead.`
    : `This may contain ${list}. If it is a secret, store it in your password manager and reference it here instead.`;
}
