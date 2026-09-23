import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeFindings, hasBlockingSecret, looksLikePointer, scanForSecrets, shannonEntropy,
} from "../src/secret-scan.ts";

test("catches a pasted private key", () => {
  const findings = scanForSecrets("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n");
  assert.ok(hasBlockingSecret(findings));
  assert.equal(findings[0]!.kind, "private_key");
});

test("catches provider tokens", () => {
  const cases: Array<[string, string]> = [
    ["AKIAIOSFODNN7EXAMPLE", "aws_access_key_id"],
    [`ghp_${"a".repeat(36)}`, "github_token"],
    ["xoxb-123456789012-abcdefghijkl", "slack_token"],
    [`sk_live_${"a".repeat(24)}`, "stripe_key"],
    [`AIza${"a".repeat(35)}`, "google_api_key"],
    [`dop_v1_${"a".repeat(64)}`, "digitalocean_token"],
    [`npm_${"a".repeat(36)}`, "npm_token"],
    [`123456789:${"A".repeat(35)}`, "telegram_bot_token"],
  ];
  for (const [value, kind] of cases) {
    const findings = scanForSecrets(`token is ${value}`);
    assert.ok(hasBlockingSecret(findings), `should block ${kind}`);
    assert.ok(findings.some((f) => f.kind === kind), `should identify ${kind}, got ${findings.map((f) => f.kind).join(",")}`);
  }
});

test("catches a webhook URL and a connection string", () => {
  assert.ok(hasBlockingSecret(scanForSecrets("https://hooks.slack.com/services/T0000/B0000/abcdefghijklmnopqrst")));
  assert.ok(hasBlockingSecret(scanForSecrets("postgres://admin:hunter2@db.example.com:5432/app")));
});

test("catches an assigned password as a warning, not a block", () => {
  const findings = scanForSecrets("password = correct-horse-battery");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "warn");
});

test("never flags a reference into a password manager", () => {
  const pointers = [
    "op://Shared/acme-namecheap/password",
    "pass://Infrastructure/web-01/ssh",
    "9f1c0b3e-4a2d-4f8b-9c31-7d4e5f6a8b90",
    "https://vault.bitwarden.com/#/vault?itemId=9f1c0b3e-4a2d-4f8b-9c31-7d4e5f6a8b90",
    "onepassword://view-item?i=abcdefghijklmnop",
  ];
  for (const pointer of pointers) {
    assert.ok(looksLikePointer(pointer), `${pointer} should read as a pointer`);
    assert.deepEqual(scanForSecrets(pointer), [], `${pointer} should not be flagged`);
  }
});

test("does not flag ordinary notes or identifiers", () => {
  const benign = [
    "Renews every January. Registrar is Namecheap.",
    "Server 203.0.113.10, Hetzner CX23 in Falkenstein.",
    "Certificate fingerprint a3f5c9e18b2d4f6a7c0e5d8b1f3a9c2e4d6b8a0f1c3e5d7b9a1c3e5d7b9a1c3e",
    "Invoice INV-2026-00184 covers the annual renewal.",
  ];
  for (const text of benign) {
    assert.deepEqual(scanForSecrets(text), [], `should not flag: ${text}`);
  }
});

test("warns about a long random string no named rule caught", () => {
  const findings = scanForSecrets(`legacy key ${"aZ9bY8cX7dW6eV5fU4gT3hS2iR1jQ0kP".repeat(1)}`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "warn");
  assert.equal(findings[0]!.kind, "high_entropy_string");
});

test("entropy separates hexadecimal from base64", () => {
  assert.ok(shannonEntropy("a".repeat(40)) < 1);
  assert.ok(shannonEntropy("a3f5c9e18b2d4f6a7c0e5d8b1f3a9c2e4d6b8a0f") <= 4.0);
  assert.ok(shannonEntropy("aZ9bY8cX7dW6eV5fU4gT3hS2iR1jQ0kP") > 4.2);
});

test("redacts what it reports", () => {
  const findings = scanForSecrets("AKIAIOSFODNN7EXAMPLE");
  assert.ok(!findings[0]!.preview.includes("IOSFODNN7"));
  assert.match(findings[0]!.preview, /^AKIA…\*{4}LE$/);
});

test("reports the same token once, not twice", () => {
  const findings = scanForSecrets(`dop_v1_${"a".repeat(64)}`);
  assert.equal(findings.length, 1);
});

test("describes findings in one sentence without repeating the secret", () => {
  const message = describeFindings(scanForSecrets("AKIAIOSFODNN7EXAMPLE"));
  assert.match(message, /password manager/);
  assert.ok(!message.includes("AKIAIOSFODNN7EXAMPLE"));
  assert.equal(describeFindings([]), "");
});
