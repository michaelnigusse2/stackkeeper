import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecretBox, SecretBoxError } from "../src/secret-box.ts";

const KEY = "a-long-enough-development-key-value-1234";
const OTHER = "a-different-key-that-is-also-long-enough";

test("seals and opens a value", () => {
  const box = createSecretBox(KEY);
  const url = "https://hooks.slack.com/services/T0/B0/abcdefghijklmnop";
  assert.equal(box.open(box.seal(url)), url);
});

test("the sealed bytes do not contain the plaintext", () => {
  const box = createSecretBox(KEY);
  const sealed = box.seal("super-secret-token");
  assert.ok(!sealed.toString("utf8").includes("super-secret-token"));
  assert.ok(!sealed.toString("hex").includes(Buffer.from("super-secret-token").toString("hex")));
});

test("the same value seals differently every time", () => {
  const box = createSecretBox(KEY);
  const a = box.seal("same input");
  const b = box.seal("same input");
  assert.notEqual(a.toString("hex"), b.toString("hex"), "a repeated nonce would leak equality");
  assert.equal(box.open(a), box.open(b));
});

test("another key cannot open it, and says why", () => {
  const sealed = createSecretBox(KEY).seal("secret");
  const other = createSecretBox(OTHER);
  assert.equal(other.canOpen(sealed), false);
  assert.throws(() => other.open(sealed), /different key/);
});

test("tampering is detected rather than silently decrypted", () => {
  const box = createSecretBox(KEY);
  const sealed = box.seal("https://hooks.slack.com/services/T0/B0/token");
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 20] ^= 0xff;
  assert.throws(() => box.open(tampered), /tampered with or is corrupt/);
});

test("refuses a truncated value", () => {
  const box = createSecretBox(KEY);
  assert.throws(() => box.open(Buffer.alloc(4)), /too short/);
});

test("refuses an unknown format version", () => {
  const box = createSecretBox(KEY);
  const sealed = box.seal("value");
  sealed[0] = 9;
  assert.throws(() => box.open(sealed), /version 9/);
});

test("refuses a key short enough to be guessable", () => {
  assert.throws(() => createSecretBox("too-short"), SecretBoxError);
});

test("handles unicode and long values", () => {
  const box = createSecretBox(KEY);
  for (const value of ["ትግራይ", "ключ", "x".repeat(4000), ""]) {
    assert.equal(box.open(box.seal(value)), value);
  }
});
